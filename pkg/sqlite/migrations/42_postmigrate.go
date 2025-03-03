package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/sliceutil/stringslice"
	"github.com/stashapp/stash/pkg/sqlite"
)

type schema42Migrator struct {
	migrator
}

func post42(ctx context.Context, db *sqlx.DB) error {
	logger.Info("Running post-migration for schema version 42")

	m := schema42Migrator{
		migrator: migrator{
			db: db,
		},
	}

	if err := m.migrate(ctx); err != nil {
		return fmt.Errorf("migrating performer aliases: %w", err)
	}

	if err := m.migrateDuplicatePerformers(ctx); err != nil {
		return fmt.Errorf("migrating performer aliases: %w", err)
	}

	if err := m.executeSchemaChanges(); err != nil {
		return fmt.Errorf("executing schema changes: %w", err)
	}

	return nil
}

func (m *schema42Migrator) migrate(ctx context.Context) error {
	logger.Info("Migrating performer aliases")

	const (
		limit    = 1000
		logEvery = 10000
	)

	lastID := 0
	count := 0

	for {
		gotSome := false

		if err := m.withTxn(ctx, func(tx *sqlx.Tx) error {
			query := "SELECT `performer_id`, `alias` FROM `performer_aliases`"

			if lastID != 0 {
				query += fmt.Sprintf(" WHERE `performer_id` > %d ", lastID)
			}

			query += fmt.Sprintf(" ORDER BY `performer_id` LIMIT %d", limit)

			rows, err := m.db.Query(query)
			if err != nil {
				return err
			}
			defer rows.Close()

			for rows.Next() {
				var (
					id      int
					aliases string
				)

				err := rows.Scan(&id, &aliases)
				if err != nil {
					return err
				}

				lastID = id
				gotSome = true
				count++

				if err := m.migratePerformerAliases(id, aliases); err != nil {
					return err
				}
			}

			return rows.Err()
		}); err != nil {
			return err
		}

		if !gotSome {
			break
		}

		if count%logEvery == 0 {
			logger.Infof("Migrated %d rows", count)
		}
	}

	return nil
}

func (m *schema42Migrator) migratePerformerAliases(id int, aliases string) error {
	// split aliases by , or /
	aliasList := strings.FieldsFunc(aliases, func(r rune) bool {
		return strings.ContainsRune(",/", r)
	})

	if len(aliasList) < 2 {
		// existing value is fine
		return nil
	}

	// delete the existing row
	if _, err := m.db.Exec("DELETE FROM `performer_aliases` WHERE `performer_id` = ?", id); err != nil {
		return err
	}

	// trim whitespace from each alias
	for i, alias := range aliasList {
		aliasList[i] = strings.TrimSpace(alias)
	}

	// remove duplicates
	aliasList = stringslice.StrAppendUniques(nil, aliasList)

	// insert aliases into table
	for _, alias := range aliasList {
		_, err := m.db.Exec("INSERT INTO `performer_aliases` (`performer_id`, `alias`) VALUES (?, ?)", id, alias)
		if err != nil {
			return err
		}
	}

	return nil
}

func (m *schema42Migrator) migrateDuplicatePerformers(ctx context.Context) error {
	logger.Info("Migrating duplicate performers")

	const (
		limit    = 1000
		logEvery = 10000
	)

	count := 0

	for {
		gotSome := false

		if err := m.withTxn(ctx, func(tx *sqlx.Tx) error {
			query := `
SELECT id, name FROM performers WHERE performers.disambiguation IS NULL AND EXISTS (
  SELECT 1 FROM performers p2 WHERE 
    performers.name = p2.name AND
	performers.rowid > p2.rowid
)`

			query += fmt.Sprintf(" ORDER BY `id` LIMIT %d", limit)

			rows, err := m.db.Query(query)
			if err != nil {
				return err
			}
			defer rows.Close()

			for rows.Next() {
				var (
					id   int
					name string
				)

				err := rows.Scan(&id, &name)
				if err != nil {
					return err
				}

				gotSome = true
				count++

				if err := m.migrateDuplicatePerformer(id, name); err != nil {
					return err
				}
			}

			return rows.Err()
		}); err != nil {
			return err
		}

		if !gotSome {
			break
		}

		if count%logEvery == 0 {
			logger.Infof("Migrated %d performers", count)
		}
	}

	return nil
}

func (m *schema42Migrator) migrateDuplicatePerformer(performerID int, name string) error {
	// get the highest value of disambiguation for this performer name
	query := `
SELECT disambiguation FROM performers WHERE name = ? ORDER BY disambiguation DESC LIMIT 1`

	var disambiguation sql.NullString
	if err := m.db.Get(&disambiguation, query, name); err != nil {
		return err
	}

	newDisambiguation := 1

	// if there is no disambiguation, set it to 1
	if disambiguation.Valid {
		numericDis, err := strconv.Atoi(disambiguation.String)
		if err != nil {
			// shouldn't happen
			return err
		}

		newDisambiguation = numericDis + 1
	}

	logger.Infof("Adding disambiguation '%d' for performer %q", newDisambiguation, name)

	_, err := m.db.Exec("UPDATE performers SET disambiguation = ? WHERE id = ?", strconv.Itoa(newDisambiguation), performerID)
	if err != nil {
		return err
	}

	return nil
}

func (m *schema42Migrator) executeSchemaChanges() error {
	return m.execAll([]string{
		"CREATE UNIQUE INDEX `performers_name_disambiguation_unique` on `performers` (`name`, `disambiguation`) WHERE `disambiguation` IS NOT NULL",
		"CREATE UNIQUE INDEX `performers_name_unique` on `performers` (`name`) WHERE `disambiguation` IS NULL",
	})
}

func init() {
	sqlite.RegisterPostMigration(42, post42)
}

import React, { useEffect, useState } from "react";
import { Button, Form, Col, Row, Badge, Dropdown } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import Mousetrap from "mousetrap";
import * as GQL from "src/core/generated-graphql";
import * as yup from "yup";
import {
  useListPerformerScrapers,
  queryScrapePerformer,
  mutateReloadScrapers,
  usePerformerUpdate,
  usePerformerCreate,
  useTagCreate,
  queryScrapePerformerURL,
} from "src/core/StashService";
import {
  Icon,
  ImageInput,
  LoadingIndicator,
  CollapseButton,
  TagSelect,
  URLField,
  CountrySelect,
} from "src/components/Shared";
import { ImageUtils, getStashIDs } from "src/utils";
import { useToast } from "src/hooks";
import { Prompt, useHistory } from "react-router-dom";
import { useFormik } from "formik";
import {
  genderStrings,
  genderToString,
  stringToGender,
} from "src/utils/gender";
import { ConfigurationContext } from "src/hooks/Config";
import { stashboxDisplayName } from "src/utils/stashbox";
import { PerformerScrapeDialog } from "./PerformerScrapeDialog";
import PerformerScrapeModal from "./PerformerScrapeModal";
import PerformerStashBoxModal, { IStashBox } from "./PerformerStashBoxModal";
import cx from "classnames";
import {
  faPlus,
  faSyncAlt,
  faTrashAlt,
} from "@fortawesome/free-solid-svg-icons";
import { StringListInput } from "src/components/Shared/StringListInput";

const isScraper = (
  scraper: GQL.Scraper | GQL.StashBox
): scraper is GQL.Scraper => (scraper as GQL.Scraper).id !== undefined;

interface IPerformerDetails {
  performer: Partial<GQL.PerformerDataFragment>;
  isNew?: boolean;
  isVisible: boolean;
  onImageChange?: (image?: string | null) => void;
  onImageEncoding?: (loading?: boolean) => void;
  onCancelEditing?: () => void;
}

export const PerformerEditPanel: React.FC<IPerformerDetails> = ({
  performer,
  isNew,
  isVisible,
  onImageChange,
  onImageEncoding,
  onCancelEditing,
}) => {
  const Toast = useToast();
  const history = useHistory();

  // Editing state
  const [scraper, setScraper] = useState<GQL.Scraper | IStashBox | undefined>();
  const [newTags, setNewTags] = useState<GQL.ScrapedTag[]>();
  const [isScraperModalOpen, setIsScraperModalOpen] = useState<boolean>(false);

  // Network state
  const [isLoading, setIsLoading] = useState(false);

  const [updatePerformer] = usePerformerUpdate();
  const [createPerformer] = usePerformerCreate();

  const Scrapers = useListPerformerScrapers();
  const [queryableScrapers, setQueryableScrapers] = useState<GQL.Scraper[]>([]);

  const [scrapedPerformer, setScrapedPerformer] = useState<
    GQL.ScrapedPerformer | undefined
  >();
  const { configuration: stashConfig } = React.useContext(ConfigurationContext);

  const imageEncoding = ImageUtils.usePasteImage(onImageLoad, true);

  const [createTag] = useTagCreate();
  const intl = useIntl();

  const genderOptions = [""].concat(genderStrings);

  const labelXS = 3;
  const labelXL = 2;
  const fieldXS = 9;
  const fieldXL = 7;

  const schema = yup.object({
    name: yup.string().required(),
    disambiguation: yup.string().optional(),
    alias_list: yup
      .array(yup.string().required())
      .optional()
      .test({
        name: "unique",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        test: (value: any) => {
          return (value ?? []).length === new Set(value).size;
        },
        message: intl.formatMessage({ id: "dialogs.aliases_must_be_unique" }),
      }),
    gender: yup.string().optional().oneOf(genderOptions),
    birthdate: yup.string().optional(),
    ethnicity: yup.string().optional(),
    eye_color: yup.string().optional(),
    country: yup.string().optional(),
    height_cm: yup.number().optional(),
    measurements: yup.string().optional(),
    fake_tits: yup.string().optional(),
    career_length: yup.string().optional(),
    tattoos: yup.string().optional(),
    piercings: yup.string().optional(),
    url: yup.string().optional(),
    twitter: yup.string().optional(),
    instagram: yup.string().optional(),
    tag_ids: yup.array(yup.string().required()).optional(),
    stash_ids: yup.mixed<GQL.StashIdInput>().optional(),
    image: yup.string().optional().nullable(),
    details: yup.string().optional(),
    death_date: yup.string().optional(),
    hair_color: yup.string().optional(),
    weight: yup.number().optional(),
    ignore_auto_tag: yup.boolean().optional(),
  });

  const initialValues = {
    name: performer.name ?? "",
    disambiguation: performer.disambiguation ?? "",
    alias_list: performer.alias_list?.slice().sort(),
    gender: genderToString(performer.gender ?? undefined),
    birthdate: performer.birthdate ?? "",
    ethnicity: performer.ethnicity ?? "",
    eye_color: performer.eye_color ?? "",
    country: performer.country ?? "",
    height_cm: performer.height_cm ?? undefined,
    measurements: performer.measurements ?? "",
    fake_tits: performer.fake_tits ?? "",
    career_length: performer.career_length ?? "",
    tattoos: performer.tattoos ?? "",
    piercings: performer.piercings ?? "",
    url: performer.url ?? "",
    twitter: performer.twitter ?? "",
    instagram: performer.instagram ?? "",
    tag_ids: (performer.tags ?? []).map((t) => t.id),
    stash_ids: performer.stash_ids ?? undefined,
    image: undefined,
    details: performer.details ?? "",
    death_date: performer.death_date ?? "",
    hair_color: performer.hair_color ?? "",
    weight: performer.weight ?? undefined,
    ignore_auto_tag: performer.ignore_auto_tag ?? false,
  };

  type InputValues = typeof initialValues;

  const formik = useFormik({
    initialValues,
    validationSchema: schema,
    onSubmit: (values) => onSave(values),
  });

  function translateScrapedGender(scrapedGender?: string) {
    if (!scrapedGender) {
      return;
    }

    let retEnum: GQL.GenderEnum | undefined;

    // try to translate from enum values first
    const upperGender = scrapedGender?.toUpperCase();
    const asEnum = genderToString(upperGender);
    if (asEnum) {
      retEnum = stringToGender(asEnum);
    } else {
      // try to match against gender strings
      const caseInsensitive = true;
      retEnum = stringToGender(scrapedGender, caseInsensitive);
    }

    return genderToString(retEnum);
  }

  function renderNewTags() {
    if (!newTags || newTags.length === 0) {
      return;
    }

    const ret = (
      <>
        {newTags.map((t) => (
          <Badge
            className="tag-item"
            variant="secondary"
            key={t.name}
            onClick={() => createNewTag(t)}
          >
            {t.name}
            <Button className="minimal ml-2">
              <Icon className="fa-fw" icon={faPlus} />
            </Button>
          </Badge>
        ))}
      </>
    );

    const minCollapseLength = 10;

    if (newTags.length >= minCollapseLength) {
      return (
        <CollapseButton text={`Missing (${newTags.length})`}>
          {ret}
        </CollapseButton>
      );
    }

    return ret;
  }

  async function createNewTag(toCreate: GQL.ScrapedTag) {
    const tagInput: GQL.TagCreateInput = { name: toCreate.name ?? "" };
    try {
      const result = await createTag({
        variables: {
          input: tagInput,
        },
      });

      if (!result.data?.tagCreate) {
        Toast.error(new Error("Failed to create tag"));
        return;
      }

      // add the new tag to the new tags value
      const newTagIds = formik.values.tag_ids.concat([
        result.data.tagCreate.id,
      ]);
      formik.setFieldValue("tag_ids", newTagIds);

      // remove the tag from the list
      const newTagsClone = newTags!.concat();
      const pIndex = newTagsClone.indexOf(toCreate);
      newTagsClone.splice(pIndex, 1);

      setNewTags(newTagsClone);

      Toast.success({
        content: (
          <span>
            Created tag: <b>{toCreate.name}</b>
          </span>
        ),
      });
    } catch (e) {
      Toast.error(e);
    }
  }

  function updatePerformerEditStateFromScraper(
    state: Partial<GQL.ScrapedPerformerDataFragment>
  ) {
    if (state.name) {
      formik.setFieldValue("name", state.name);
    }
    if (state.disambiguation) {
      formik.setFieldValue("disambiguation", state.disambiguation);
    }
    if (state.aliases) {
      formik.setFieldValue(
        "alias_list",
        state.aliases.split(",").map((a) => a.trim())
      );
    }
    if (state.birthdate) {
      formik.setFieldValue("birthdate", state.birthdate);
    }
    if (state.ethnicity) {
      formik.setFieldValue("ethnicity", state.ethnicity);
    }
    if (state.country) {
      formik.setFieldValue("country", state.country);
    }
    if (state.eye_color) {
      formik.setFieldValue("eye_color", state.eye_color);
    }
    if (state.height) {
      formik.setFieldValue("height_cm", parseInt(state.height, 10));
    }
    if (state.measurements) {
      formik.setFieldValue("measurements", state.measurements);
    }
    if (state.fake_tits) {
      formik.setFieldValue("fake_tits", state.fake_tits);
    }
    if (state.career_length) {
      formik.setFieldValue("career_length", state.career_length);
    }
    if (state.tattoos) {
      formik.setFieldValue("tattoos", state.tattoos);
    }
    if (state.piercings) {
      formik.setFieldValue("piercings", state.piercings);
    }
    if (state.url) {
      formik.setFieldValue("url", state.url);
    }
    if (state.twitter) {
      formik.setFieldValue("twitter", state.twitter);
    }
    if (state.instagram) {
      formik.setFieldValue("instagram", state.instagram);
    }
    if (state.gender) {
      // gender is a string in the scraper data
      formik.setFieldValue(
        "gender",
        translateScrapedGender(state.gender ?? undefined)
      );
    }
    if (state.tags) {
      // map tags to their ids and filter out those not found
      const newTagIds = state.tags.map((t) => t.stored_id).filter((t) => t);
      formik.setFieldValue("tag_ids", newTagIds);

      setNewTags(state.tags.filter((t) => !t.stored_id));
    }

    // image is a base64 string
    // #404: don't overwrite image if it has been modified by the user
    // overwrite if not new since it came from a dialog
    // overwrite if image was cleared (`null`)
    // otherwise follow existing behaviour (`undefined`)
    if (
      (!isNew || [null, undefined].includes(formik.values.image)) &&
      state.images &&
      state.images.length > 0
    ) {
      const imageStr = state.images[0];
      formik.setFieldValue("image", imageStr ?? undefined);
    }
    if (state.details) {
      formik.setFieldValue("details", state.details);
    }
    if (state.death_date) {
      formik.setFieldValue("death_date", state.death_date);
    }
    if (state.hair_color) {
      formik.setFieldValue("hair_color", state.hair_color);
    }
    if (state.weight) {
      formik.setFieldValue("weight", state.weight);
    }

    const remoteSiteID = state.remote_site_id;
    if (remoteSiteID && (scraper as IStashBox).endpoint) {
      const newIDs =
        formik.values.stash_ids?.filter(
          (s) => s.endpoint !== (scraper as IStashBox).endpoint
        ) ?? [];
      newIDs?.push({
        endpoint: (scraper as IStashBox).endpoint,
        stash_id: remoteSiteID,
      });
      formik.setFieldValue("stash_ids", newIDs);
    }
  }

  function onImageLoad(imageData: string) {
    formik.setFieldValue("image", imageData);
  }

  async function onSave(performerInput: InputValues) {
    setIsLoading(true);
    try {
      if (isNew) {
        const input = getCreateValues(performerInput);
        const result = await createPerformer({
          variables: {
            input,
          },
        });
        if (result.data?.performerCreate) {
          history.push(`/performers/${result.data.performerCreate.id}`);
        }
      } else {
        const input = getUpdateValues(performerInput);

        await updatePerformer({
          variables: {
            input: {
              ...input,
              stash_ids: getStashIDs(performerInput?.stash_ids),
            },
          },
        });
      }
    } catch (e) {
      Toast.error(e);
      setIsLoading(false);
      return;
    }
    if (!isNew && onCancelEditing) {
      onCancelEditing();
    }
    setIsLoading(false);
  }

  // set up hotkeys
  useEffect(() => {
    if (isVisible) {
      Mousetrap.bind("s s", () => {
        onSave?.(formik.values);
      });

      return () => {
        Mousetrap.unbind("s s");

        if (!isNew) {
          Mousetrap.unbind("d d");
        }
      };
    }
  });

  useEffect(() => {
    if (onImageChange) {
      onImageChange(formik.values.image);
    }
    return () => onImageChange?.();
  }, [formik.values.image, onImageChange]);

  useEffect(() => onImageEncoding?.(imageEncoding), [
    onImageEncoding,
    imageEncoding,
  ]);

  useEffect(() => {
    const newQueryableScrapers = (
      Scrapers?.data?.listPerformerScrapers ?? []
    ).filter((s) =>
      s.performer?.supported_scrapes.includes(GQL.ScrapeType.Name)
    );

    setQueryableScrapers(newQueryableScrapers);
  }, [Scrapers]);

  if (isLoading) return <LoadingIndicator />;

  function getUpdateValues(values: InputValues): GQL.PerformerUpdateInput {
    return {
      ...values,
      gender: stringToGender(values.gender) ?? null,
      height_cm: values.height_cm ? Number(values.height_cm) : null,
      weight: values.weight ? Number(values.weight) : null,
      id: performer.id ?? "",
    };
  }

  function getCreateValues(values: InputValues): GQL.PerformerCreateInput {
    return {
      ...values,
      gender: stringToGender(values.gender),
      height_cm: values.height_cm ? Number(values.height_cm) : null,
      weight: values.weight ? Number(values.weight) : null,
    };
  }

  function onImageChangeHandler(event: React.FormEvent<HTMLInputElement>) {
    ImageUtils.onImageChange(event, onImageLoad);
  }

  function onImageChangeURL(url: string) {
    formik.setFieldValue("image", url);
  }

  async function onReloadScrapers() {
    setIsLoading(true);
    try {
      await mutateReloadScrapers();

      // reload the performer scrapers
      await Scrapers.refetch();
    } catch (e) {
      Toast.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  async function onScrapePerformer(
    selectedPerformer: GQL.ScrapedPerformerDataFragment,
    selectedScraper: GQL.Scraper
  ) {
    setIsScraperModalOpen(false);
    try {
      if (!scraper) return;
      setIsLoading(true);

      const {
        __typename,
        images: _image,
        tags: _tags,
        ...ret
      } = selectedPerformer;

      const result = await queryScrapePerformer(selectedScraper.id, ret);
      if (!result?.data?.scrapeSinglePerformer?.length) return;

      // assume one result
      // if this is a new performer, just dump the data
      if (isNew) {
        updatePerformerEditStateFromScraper(
          result.data.scrapeSinglePerformer[0]
        );
        setScraper(undefined);
      } else {
        setScrapedPerformer(result.data.scrapeSinglePerformer[0]);
      }
    } catch (e) {
      Toast.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  async function onScrapePerformerURL() {
    const { url } = formik.values;
    if (!url) return;
    setIsLoading(true);
    try {
      const result = await queryScrapePerformerURL(url);
      if (!result.data || !result.data.scrapePerformerURL) {
        return;
      }

      // if this is a new performer, just dump the data
      if (isNew) {
        updatePerformerEditStateFromScraper(result.data.scrapePerformerURL);
      } else {
        setScrapedPerformer(result.data.scrapePerformerURL);
      }
    } catch (e) {
      Toast.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  async function onScrapeStashBox(performerResult: GQL.ScrapedPerformer) {
    setIsScraperModalOpen(false);

    const result: GQL.ScrapedPerformerDataFragment = {
      ...performerResult,
      images: performerResult.images ?? undefined,
      __typename: "ScrapedPerformer",
    };

    // if this is a new performer, just dump the data
    if (isNew) {
      updatePerformerEditStateFromScraper(result);
      setScraper(undefined);
    } else {
      setScrapedPerformer(result);
    }
  }

  function onScraperSelected(s: GQL.Scraper | IStashBox | undefined) {
    setScraper(s);
    setIsScraperModalOpen(true);
  }

  function renderScraperMenu() {
    if (!performer) {
      return;
    }
    const stashBoxes = stashConfig?.general.stashBoxes ?? [];

    const popover = (
      <Dropdown.Menu id="performer-scraper-popover">
        {stashBoxes.map((s, index) => (
          <Dropdown.Item
            as={Button}
            key={s.endpoint}
            className="minimal"
            onClick={() => onScraperSelected({ ...s, index })}
          >
            {stashboxDisplayName(s.name, index)}
          </Dropdown.Item>
        ))}
        {queryableScrapers
          ? queryableScrapers.map((s) => (
              <Dropdown.Item
                as={Button}
                key={s.name}
                className="minimal"
                onClick={() => onScraperSelected(s)}
              >
                {s.name}
              </Dropdown.Item>
            ))
          : ""}
        <Dropdown.Item
          as={Button}
          className="minimal"
          onClick={() => onReloadScrapers()}
        >
          <span className="fa-icon">
            <Icon icon={faSyncAlt} />
          </span>
          <span>
            <FormattedMessage id="actions.reload_scrapers" />
          </span>
        </Dropdown.Item>
      </Dropdown.Menu>
    );

    return (
      <Dropdown drop="up" className="d-inline-block">
        <Dropdown.Toggle variant="secondary" className="mr-2">
          <FormattedMessage id="actions.scrape_with" />
        </Dropdown.Toggle>
        {popover}
      </Dropdown>
    );
  }

  function urlScrapable(scrapedUrl?: string) {
    return (
      !!scrapedUrl &&
      (Scrapers?.data?.listPerformerScrapers ?? []).some((s) =>
        (s?.performer?.urls ?? []).some((u) => scrapedUrl.includes(u))
      )
    );
  }

  function maybeRenderScrapeDialog() {
    if (!scrapedPerformer) {
      return;
    }

    const currentPerformer: Partial<GQL.PerformerUpdateInput> = {
      ...formik.values,
      gender: stringToGender(formik.values.gender),
      image: formik.values.image ?? performer.image_path,
    };

    return (
      <PerformerScrapeDialog
        performer={currentPerformer}
        scraped={scrapedPerformer}
        scraper={scraper}
        onClose={(p) => {
          onScrapeDialogClosed(p);
        }}
      />
    );
  }

  function onScrapeDialogClosed(p?: GQL.ScrapedPerformerDataFragment) {
    if (p) {
      updatePerformerEditStateFromScraper(p);
    }
    setScrapedPerformer(undefined);
    setScraper(undefined);
  }

  function renderButtons(classNames: string) {
    return (
      <div className={cx("details-edit", "col-xl-9", classNames)}>
        {!isNew && onCancelEditing ? (
          <Button
            className="mr-2"
            variant="primary"
            onClick={() => onCancelEditing()}
          >
            <FormattedMessage id="actions.cancel" />
          </Button>
        ) : (
          ""
        )}
        {renderScraperMenu()}
        <ImageInput
          isEditing
          onImageChange={onImageChangeHandler}
          onImageURL={onImageChangeURL}
        />
        <div>
          <Button
            className="mr-2"
            variant="danger"
            onClick={() => formik.setFieldValue("image", null)}
          >
            <FormattedMessage id="actions.clear_image" />
          </Button>
        </div>
        <Button
          variant="success"
          disabled={!formik.dirty}
          onClick={() => formik.submitForm()}
        >
          <FormattedMessage id="actions.save" />
        </Button>
      </div>
    );
  }

  const renderScrapeModal = () => {
    if (!isScraperModalOpen) return;

    return scraper !== undefined && isScraper(scraper) ? (
      <PerformerScrapeModal
        scraper={scraper}
        onHide={() => setScraper(undefined)}
        onSelectPerformer={onScrapePerformer}
        name={formik.values.name || ""}
      />
    ) : scraper !== undefined && !isScraper(scraper) ? (
      <PerformerStashBoxModal
        instance={scraper}
        onHide={() => setScraper(undefined)}
        onSelectPerformer={onScrapeStashBox}
        name={formik.values.name || ""}
      />
    ) : undefined;
  };

  function renderTagsField() {
    return (
      <Form.Group controlId="tags" as={Row}>
        <Form.Label column sm={labelXS} xl={labelXL}>
          <FormattedMessage id="tags" defaultMessage="Tags" />
        </Form.Label>
        <Col xs={fieldXS} xl={fieldXL}>
          <TagSelect
            menuPortalTarget={document.body}
            isMulti
            onSelect={(items) =>
              formik.setFieldValue(
                "tag_ids",
                items.map((item) => item.id)
              )
            }
            ids={formik.values.tag_ids}
          />
          {renderNewTags()}
        </Col>
      </Form.Group>
    );
  }

  const removeStashID = (stashID: GQL.StashIdInput) => {
    formik.setFieldValue(
      "stash_ids",
      (formik.values.stash_ids ?? []).filter(
        (s) =>
          !(s.endpoint === stashID.endpoint && s.stash_id === stashID.stash_id)
      )
    );
  };

  function renderStashIDs() {
    if (!formik.values.stash_ids?.length) {
      return;
    }

    return (
      <Row>
        <Form.Label column sm={labelXS} xl={labelXL}>
          StashIDs
        </Form.Label>
        <Col sm={fieldXS} xl={fieldXL}>
          <ul className="pl-0">
            {formik.values.stash_ids.map((stashID) => {
              const base = stashID.endpoint.match(/https?:\/\/.*?\//)?.[0];
              const link = base ? (
                <a
                  href={`${base}performers/${stashID.stash_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {stashID.stash_id}
                </a>
              ) : (
                stashID.stash_id
              );
              return (
                <li key={stashID.stash_id} className="row no-gutters mb-1">
                  <Button
                    variant="danger"
                    className="mr-2 py-0"
                    title={intl.formatMessage({ id: "actions.delete_stashid" })}
                    onClick={() => removeStashID(stashID)}
                  >
                    <Icon icon={faTrashAlt} />
                  </Button>
                  {link}
                </li>
              );
            })}
          </ul>
        </Col>
      </Row>
    );
  }

  function renderField(
    field: string,
    props?: {
      messageID?: string;
      placeholder?: string;
      type?: string;
    }
  ) {
    const title = intl.formatMessage({ id: props?.messageID ?? field });

    return (
      <Form.Group controlId={field} as={Row}>
        <Form.Label column xs={labelXS} xl={labelXL}>
          {title}
        </Form.Label>
        <Col xs={fieldXS} xl={fieldXL}>
          <Form.Control
            type={props?.type ?? "text"}
            className="text-input"
            placeholder={props?.placeholder ?? title}
            {...formik.getFieldProps(field)}
            isInvalid={!!formik.getFieldMeta(field).error}
          />
        </Col>
      </Form.Group>
    );
  }

  return (
    <>
      {renderScrapeModal()}
      {maybeRenderScrapeDialog()}

      <Prompt
        when={formik.dirty}
        message={intl.formatMessage({ id: "dialogs.unsaved_changes" })}
      />
      {renderButtons("mb-3")}

      <Form noValidate onSubmit={formik.handleSubmit} id="performer-edit">
        <Form.Group controlId="name" as={Row}>
          <Form.Label column xs={labelXS} xl={labelXL}>
            <FormattedMessage id="name" />
          </Form.Label>
          <Col xs={fieldXS} xl={fieldXL}>
            <Form.Control
              className="text-input"
              placeholder={intl.formatMessage({ id: "name" })}
              {...formik.getFieldProps("name")}
              isInvalid={!!formik.errors.name}
            />
            <Form.Control.Feedback type="invalid">
              {formik.errors.name}
            </Form.Control.Feedback>
          </Col>
        </Form.Group>

        <Form.Group controlId="disambiguation" as={Row}>
          <Form.Label column xs={labelXS} xl={labelXL}>
            <FormattedMessage id="disambiguation" />
          </Form.Label>
          <Col xs={fieldXS} xl={fieldXL}>
            <Form.Control
              className="text-input"
              placeholder={intl.formatMessage({ id: "disambiguation" })}
              {...formik.getFieldProps("disambiguation")}
              isInvalid={!!formik.errors.disambiguation}
            />
            <Form.Control.Feedback type="invalid">
              {formik.errors.disambiguation}
            </Form.Control.Feedback>
          </Col>
        </Form.Group>

        <Form.Group controlId="aliases" as={Row}>
          <Form.Label column xs={labelXS} xl={labelXL}>
            <FormattedMessage id="aliases" />
          </Form.Label>
          <Col xs={fieldXS} xl={fieldXL}>
            <StringListInput
              value={formik.values.alias_list ?? []}
              setValue={(value) => formik.setFieldValue("alias_list", value)}
              errors={formik.errors.alias_list}
            />
          </Col>
        </Form.Group>

        <Form.Group as={Row}>
          <Form.Label column xs={labelXS} xl={labelXL}>
            <FormattedMessage id="gender" />
          </Form.Label>
          <Col xs="auto">
            <Form.Control
              as="select"
              className="input-control"
              {...formik.getFieldProps("gender")}
            >
              {genderOptions.map((opt) => (
                <option value={opt} key={opt}>
                  {opt}
                </option>
              ))}
            </Form.Control>
          </Col>
        </Form.Group>

        {renderField("birthdate", { placeholder: "YYYY-MM-DD" })}
        {renderField("death_date", { placeholder: "YYYY-MM-DD" })}

        <Form.Group as={Row}>
          <Form.Label column xs={labelXS} xl={labelXL}>
            <FormattedMessage id="country" />
          </Form.Label>
          <Col xs={fieldXS} xl={fieldXL}>
            <CountrySelect
              value={formik.getFieldProps("country").value}
              onChange={(value) => formik.setFieldValue("country", value)}
            />
          </Col>
        </Form.Group>

        {renderField("ethnicity")}
        {renderField("hair_color")}
        {renderField("eye_color")}
        {renderField("height_cm", {
          type: "number",
        })}
        {renderField("weight", {
          type: "number",
          messageID: "weight_kg",
        })}
        {renderField("measurements")}
        {renderField("fake_tits")}

        <Form.Group controlId="tattoos" as={Row}>
          <Form.Label column sm={labelXS} xl={labelXL}>
            <FormattedMessage id="tattoos" />
          </Form.Label>
          <Col sm={fieldXS} xl={fieldXL}>
            <Form.Control
              as="textarea"
              className="text-input"
              placeholder={intl.formatMessage({ id: "tattoos" })}
              {...formik.getFieldProps("tattoos")}
            />
          </Col>
        </Form.Group>

        <Form.Group controlId="piercings" as={Row}>
          <Form.Label column sm={labelXS} xl={labelXL}>
            <FormattedMessage id="piercings" />
          </Form.Label>
          <Col sm={fieldXS} xl={fieldXL}>
            <Form.Control
              as="textarea"
              className="text-input"
              placeholder={intl.formatMessage({ id: "piercings" })}
              {...formik.getFieldProps("piercings")}
            />
          </Col>
        </Form.Group>

        {renderField("career_length")}

        <Form.Group controlId="url" as={Row}>
          <Form.Label column xs={labelXS} xl={labelXL}>
            <FormattedMessage id="url" />
          </Form.Label>
          <Col xs={fieldXS} xl={fieldXL}>
            <URLField
              {...formik.getFieldProps("url")}
              onScrapeClick={onScrapePerformerURL}
              urlScrapable={urlScrapable}
            />
          </Col>
        </Form.Group>

        {renderField("twitter")}
        {renderField("instagram")}
        <Form.Group controlId="details" as={Row}>
          <Form.Label column sm={labelXS} xl={labelXL}>
            <FormattedMessage id="details" />
          </Form.Label>
          <Col sm={fieldXS} xl={fieldXL}>
            <Form.Control
              as="textarea"
              className="text-input"
              placeholder={intl.formatMessage({ id: "details" })}
              {...formik.getFieldProps("details")}
            />
          </Col>
        </Form.Group>
        {renderTagsField()}

        {renderStashIDs()}

        <hr />

        <Form.Group controlId="ignore-auto-tag" as={Row}>
          <Form.Label column sm={labelXS} xl={labelXL}>
            <FormattedMessage id="ignore_auto_tag" />
          </Form.Label>
          <Col sm={fieldXS} xl={fieldXL}>
            <Form.Check
              {...formik.getFieldProps({
                name: "ignore_auto_tag",
                type: "checkbox",
              })}
            />
          </Col>
        </Form.Group>

        {renderButtons("mt-3")}
      </Form>
    </>
  );
};

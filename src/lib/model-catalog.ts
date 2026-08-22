export type ModelModality = "image" | "video" | "audio" | "all";

export interface ListModelsOptions {
  modality?: ModelModality;
  search?: string;
  limit?: number;
  refresh?: boolean;
  sort_by?: "default" | "name" | "price";
  sort_order?: "asc" | "desc";
  paid_only?: boolean;
  supports_reference_images?: boolean;
  supports_end_frame?: boolean;
  supports_audio?: boolean;
}

export interface PollinationsModel {
  name?: string;
  id?: string;
  type?: string;
  modality?: string;
  modalities?: string[];
  category?: string;
  brand?: string;
  title?: string;
  description?: string;
  aliases?: string[];
  input_modalities?: string[];
  output_modalities?: string[];
  voices?: string[];
  max_reference_images?: number;
  paid_only?: boolean;
  price?: unknown;
  pricing?: unknown;
  capabilities?: unknown;
  video_capabilities?: unknown;
  image_capabilities?: unknown;
  audio_capabilities?: unknown;
  [key: string]: unknown;
}

export function filterModels(
  models: PollinationsModel[],
  options: ListModelsOptions
): PollinationsModel[] {
  return models
    .filter((model) => matchesModality(model, options.modality ?? "all"))
    .filter((model) => matchesSearch(model, options.search))
    .filter((model) => matchesPaidOnly(model, options.paid_only))
    .filter((model) => matchesReferenceImages(model, options.supports_reference_images))
    .filter((model) => matchesEndFrame(model, options.supports_end_frame))
    .filter((model) => matchesAudio(model, options.supports_audio))
    .sort((a, b) => compareModels(a, b, options.sort_by ?? "default", options.sort_order ?? "asc"))
    .slice(0, options.limit ?? 50);
}

export function findModel(
  models: PollinationsModel[],
  name: string
): PollinationsModel | undefined {
  const normalizedName = name.toLowerCase();

  return models.find((model) => {
    const names = [
      model.name,
      model.id,
      ...(Array.isArray(model.aliases) ? model.aliases : [])
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return names.includes(normalizedName);
  });
}

function matchesSearch(model: PollinationsModel, search: string | undefined): boolean {
  if (!search) {
    return true;
  }

  const haystack = JSON.stringify(model).toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function matchesPaidOnly(model: PollinationsModel, paidOnly: boolean | undefined): boolean {
  if (paidOnly === undefined) {
    return true;
  }

  return model.paid_only === paidOnly;
}

function matchesReferenceImages(model: PollinationsModel, required: boolean | undefined): boolean {
  if (required === undefined) {
    return true;
  }

  return ((model.max_reference_images ?? 0) > 0) === required;
}

function matchesEndFrame(model: PollinationsModel, required: boolean | undefined): boolean {
  if (required === undefined) {
    return true;
  }

  return stringArray(model.video_capabilities).includes("end_frame") === required;
}

function matchesAudio(model: PollinationsModel, required: boolean | undefined): boolean {
  if (required === undefined) {
    return true;
  }

  const supportsAudio =
    model.category === "audio" ||
    stringArray(model.output_modalities).includes("audio") ||
    stringArray(model.video_capabilities).includes("audio_output");

  return supportsAudio === required;
}

function compareModels(
  a: PollinationsModel,
  b: PollinationsModel,
  sortBy: "default" | "name" | "price",
  sortOrder: "asc" | "desc"
): number {
  if (sortBy === "default") {
    return 0;
  }

  const direction = sortOrder === "asc" ? 1 : -1;

  if (sortBy === "name") {
    return String(a.name ?? "").localeCompare(String(b.name ?? "")) * direction;
  }

  const aPrice = modelLowestPrice(a);
  const bPrice = modelLowestPrice(b);

  if (aPrice === undefined && bPrice === undefined) {
    return 0;
  }
  if (aPrice === undefined) {
    return 1;
  }
  if (bPrice === undefined) {
    return -1;
  }

  return (aPrice - bPrice) * direction;
}

function modelLowestPrice(model: PollinationsModel): number | undefined {
  if (!isRecord(model.pricing)) {
    return undefined;
  }

  const values = Object.entries(model.pricing)
    .filter(([key]) => key !== "currency")
    .map(([, value]) => Number(value))
    .filter((value) => Number.isFinite(value));

  return values.length > 0 ? Math.min(...values) : undefined;
}

function matchesModality(model: PollinationsModel, modality: ModelModality): boolean {
  if (modality === "all") {
    return true;
  }

  if (model.category === modality) {
    return true;
  }

  if (model.output_modalities?.includes(modality)) {
    return true;
  }

  const searchable = [
    model.type,
    model.modality,
    model.category,
    ...(Array.isArray(model.modalities) ? model.modalities : []),
    ...(Array.isArray(model.output_modalities) ? model.output_modalities : []),
    JSON.stringify(model.capabilities ?? {}),
    JSON.stringify(model.video_capabilities ?? {}),
    JSON.stringify(model.image_capabilities ?? {}),
    JSON.stringify(model.audio_capabilities ?? {})
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchable.includes(modality);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

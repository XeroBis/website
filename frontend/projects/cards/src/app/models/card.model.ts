export interface CardDetails {
  name?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  evolveFrom?: string;
  attacks?: { name: string; cost?: string[]; damage?: string | number; effect?: string }[];
  abilities?: { name: string; type?: string; effect?: string }[];
  effect?: string;
  weaknesses?: { type: string; value?: string }[];
  resistances?: { type: string; value?: string }[];
  retreat?: number;
  illustrator?: string;
  regulationMark?: string;
}

export interface CardCatalogEntry {
  details?: { en?: CardDetails; fr?: CardDetails } | null;
  id: number;
  name: string;
  variants: CardCatalogVariant[];
  set_name: string;
  set_name_fr: string | null;
  set_code: string;
  card_number: string;
  image_path: string;
  source_url: string | null;
  supertype: string | null;
  rarity: string | null;
  series: string | null;
  card_count: number | null;
  release_date: string | null;
  created_at: string;
}

export interface CardCatalogPage {
  total: number;
  page: number;
  page_size: number;
  items: CardCatalogEntry[];
}

export interface CardSet {
  set_code: string;
  set_name: string;
  /** French source set name, retained for bilingual search and as the
   * fallback data behind the server-resolved `set_name` display field. */
  set_name_fr: string | null;
  series: string | null;
  /** Localized label for the raw `series` grouping key. */
  series_display_name: string | null;
  card_count: number | null;
  release_date: string | null;
  /** Relative to /api/cards/images/ (see main.py) -- not guaranteed to exist on
   * disk, fall back to no image on a 404. */
  logo_path: string | null;
  logo_path_fr: string | null;
  symbol_path: string | null;
  /** Owned/total among normally-numbered cards only (excludes secret/ultra
   * rares numbered past the set's official card_count) -- null if the set
   * has no normally-numbered cards at all. */
  completion_percent: number | null;
}

/** One set's line in the missing-cards export grid, for its options. */
export interface SetMissingSummary {
  set_code: string;
  missing: number;
  total: number;
  completion_percent: number;
}

/** A compact inclusive run of missing numeric card IDs in a set. */
export interface MissingCardInterval {
  start_number: number;
  end_number: number;
}

/** GET /api/cards/catalog/missing-intervals -- the bulk-shopping view. */
export interface MissingSetIntervals {
  set_code: string;
  set_name: string;
  series: string | null;
  symbol_path: string | null;
  missing_count: number;
  intervals: MissingCardInterval[];
  missing_numbers: number[];
  owned_numbers: number[];
  excluded_numbers: number[];
}

export interface CardDeckUsage {
  deck_id: number;
  deck_name: string;
  quantity_in_deck: number;
}

/** GET /api/cards/catalog/{catalog_id}/deck-usage -- powers the shared card detail
 * modal's "used in decks" section from any page, including ones (Browse, Set
 * detail) that only have a CardCatalogEntry rather than an owned Card. */
export interface CardCatalogDeckUsage {
  allocated_decks: CardDeckUsage[];
  phantom_decks: CardDeckUsage[];
}

/** All known print-variant type values -- see documentation/data-model.md's
 * `card_catalog_variants`/`card_variant_quantities`. `standard`/`reverse`
 * exist for every card unconditionally; the rest are conditionally scraped
 * from pokecardex.com per-card. */
export type VariantType =
  | 'standard'
  | 'reverse'
  | 'reverse_pokeball'
  | 'reverse_friendball'
  | 'reverse_loveball'
  | 'reverse_duskball'
  | 'reverse_quickball'
  | 'reverse_rocketball'
  | 'reverse_masterball'
  | 'winner_promo'
  | 'stamp_league'
  | 'stamp_professor_program'
  | 'stamp_regional_championships'
  | 'stamp_pokemon_day'
  | 'stamp_league_cup'
  | 'stamp_euic'
  | 'stamp_ocic'
  | 'stamp_laic'
  | 'stamp_naic'
  | 'holo_mirage'
  | 'holo_cosmos'
  | 'non_holo'
  | 'stamp_pokemon_tcg_gym'
  | 'text_error_before_errata'
  | 'staff_regional_championships'
  | 'staff_prerelease'
  | 'staff_league_cup'
  | 'staff_euic'
  | 'staff_ocic'
  | 'staff_laic'
  | 'staff_naic'
  | 'holo_mirror'
  | 'holo_cracked_ice'
  | 'holo_sheen'
  | '1st_place_league_challenge'
  | '2nd_place_league_challenge'
  | '3rd_place_league_challenge'
  | '4th_place_league_challenge'
  | 'holo_water_web'
  | 'top_8_euic'
  | 'top_8_ocic'
  | 'top_8_laic'
  | 'top_8_naic'
  | 'champion_euic'
  | 'champion_ocic'
  | 'champion_laic'
  | 'champion_naic'
  | 'holo_sequin'
  | 'stamp_gamestop'
  | 'stamp_eb_games'
  | 'stamp_25th_anniversary'
  | 'stamp_play_pokemon'
  | 'ditto_sticker'
  | 'with_pogo_code'
  | 'stamp_pokemon_center'
  | 'stamp_iono_s_gadgets'
  | 'metal'
  | 'champion_professor_program'
  | 'top_8_professor_program'
  | 'staff_professor_program'
  | 'worlds_staff'
  | 'worlds_top_thirty_two'
  | 'worlds_top_sixteen'
  | 'worlds_quarter_finalist'
  | 'worlds_semi_finalist'
  | 'worlds_finalist'
  | 'worlds_champion'
  | 'stamp_asia_championship_series'
  | 'stamp_pokemon_together'
  | 'top_8_championships_hong_kong_en'
  | 'champion_championships_hong_kong_en'
  | 'staff_championships_hong_kong_en'
  | 'stamp_championships_hong_kong_en'
  | 'stamp_championships_malaysia'
  | 'stamp_championships_singapore'
  | 'stamp_championships_philippines'
  | 'staff_championships_malaysia'
  | 'staff_championships_singapore'
  | 'staff_championships_philippines'
  | 'top_8_championships_malaysia'
  | 'top_8_championships_singapore'
  | 'top_8_championships_philippines'
  | 'champion_championships_malaysia'
  | 'champion_championships_singapore'
  | 'champion_championships_philippines'
  | 'stamp_philippines_league_regional'
  | 'stamp_singapore_league_regional'
  | 'stamp_pokemon_tcg_beginner_s_session'
  | 'holo_acid_wash'
  | 'stamp_malaysia_league_regional'
  | 'stamp_hong_kong_en_league_regional'
  | 'holo_line'
  | 'holo_star'
  | 'stamp_set_logo'
  | 'without_stamp'
  | 'holo_confetti'
  | 'stamp_eb_games_canada'
  | 'cosmos_reverse'
  | 'stamp_world_championships_2024'
  | 'stamp_7_eleven'
  | 'stamp_rain_city_showcase'
  | 'stamp_premier_ball_league'
  | 'stamp_great_ball_league'
  | 'stamp_ultra_ball_league'
  | 'stamp_horizons_the_series'
  | 'stamp_premier_ball_league_judge'
  | 'alternative_pokedex_description'
  | 'yellow_double_star_rarity_special_illustration_rare'
  | 'stamp_master_ball_league'
  | 'stamp_master_ball_league_judge'
  | 'top_4_professor_program'
  | 'stamp_thank_you'
  | 'stamp_set_logo_right'
  | 'stamp_set_logo_left'
  | 'stamp_asia_promo'
  | 'stamp_trick_or_trade'
  | 'gold_signature'
  | 'finalist_professor_program'
  | 'stamp_fossil_museum'
  | 'stamp_pokemonxp'
  | 'stamp_what_s_your_favorite';

export const VARIANT_LABELS: Record<VariantType, string> = {
  standard: 'Standard',
  reverse: 'Reverse',
  reverse_pokeball: 'Reverse Poké Ball',
  reverse_friendball: 'Reverse Friend Ball',
  reverse_loveball: 'Reverse Love Ball',
  reverse_duskball: 'Reverse Dusk Ball',
  reverse_quickball: 'Reverse Quick Ball',
  reverse_rocketball: 'Reverse Rocket Ball',
  reverse_masterball: 'Reverse Master Ball',
  winner_promo: 'Winner (Promo)',
  stamp_league: 'Stamp (League)',
  stamp_professor_program: 'Stamp (Professor Program)',
  stamp_regional_championships: 'Stamp (Regional Championships)',
  stamp_pokemon_day: 'Stamp (Pokémon Day)',
  stamp_league_cup: 'Stamp (League Cup)',
  stamp_euic: 'Stamp (EUIC)',
  stamp_ocic: 'Stamp (OCIC)',
  stamp_laic: 'Stamp (LAIC)',
  stamp_naic: 'Stamp (NAIC)',
  holo_mirage: 'Holo Mirage',
  holo_cosmos: 'Holo Cosmos',
  non_holo: 'Non Holo',
  stamp_pokemon_tcg_gym: 'Stamp (Pokémon TCG Gym)',
  text_error_before_errata: 'Text error (Before Errata)',
  staff_regional_championships: 'Staff (Regional Championships)',
  staff_prerelease: 'Staff (Prerelease)',
  staff_league_cup: 'Staff (League Cup)',
  staff_euic: 'Staff (EUIC)',
  staff_ocic: 'Staff (OCIC)',
  staff_laic: 'Staff (LAIC)',
  staff_naic: 'Staff (NAIC)',
  holo_mirror: 'Holo Mirror',
  holo_cracked_ice: 'Holo Cracked Ice',
  holo_sheen: 'Holo Sheen',
  '1st_place_league_challenge': '1st Place (League Challenge)',
  '2nd_place_league_challenge': '2nd Place (League Challenge)',
  '3rd_place_league_challenge': '3rd Place (League Challenge)',
  '4th_place_league_challenge': '4th Place (League Challenge)',
  holo_water_web: 'Holo Water Web',
  top_8_euic: 'Top 8 (EUIC)',
  top_8_ocic: 'Top 8 (OCIC)',
  top_8_laic: 'Top 8 (LAIC)',
  top_8_naic: 'Top 8 (NAIC)',
  champion_euic: 'Champion (EUIC)',
  champion_ocic: 'Champion (OCIC)',
  champion_laic: 'Champion (LAIC)',
  champion_naic: 'Champion (NAIC)',
  holo_sequin: 'Holo Sequin',
  stamp_gamestop: 'Stamp (GameStop)',
  stamp_eb_games: 'Stamp (EB Games)',
  stamp_25th_anniversary: 'Stamp (25th Anniversary)',
  stamp_play_pokemon: 'Stamp (Play! Pokémon)',
  ditto_sticker: 'Ditto Sticker',
  with_pogo_code: 'With POGO code',
  stamp_pokemon_center: 'Stamp (Pokémon Center)',
  stamp_iono_s_gadgets: "Stamp (Iono's Gadgets)",
  metal: 'Metal',
  champion_professor_program: 'Champion (Professor Program)',
  top_8_professor_program: 'Top 8 (Professor Program)',
  staff_professor_program: 'Staff (Professor Program)',
  worlds_staff: 'Worlds (Staff)',
  worlds_top_thirty_two: 'Worlds (Top Thirty-Two)',
  worlds_top_sixteen: 'Worlds (Top Sixteen)',
  worlds_quarter_finalist: 'Worlds (Quarter Finalist)',
  worlds_semi_finalist: 'Worlds (Semi-Finalist)',
  worlds_finalist: 'Worlds (Finalist)',
  worlds_champion: 'Worlds (Champion)',
  stamp_asia_championship_series: 'Stamp (Asia Championship Series)',
  stamp_pokemon_together: 'Stamp (Pokémon Together)',
  top_8_championships_hong_kong_en: 'Top 8 (Championships Hong Kong EN)',
  champion_championships_hong_kong_en: 'Champion (Championships Hong Kong EN)',
  staff_championships_hong_kong_en: 'Staff (Championships Hong Kong EN)',
  stamp_championships_hong_kong_en: 'Stamp (Championships Hong Kong EN)',
  stamp_championships_malaysia: 'Stamp (Championships Malaysia)',
  stamp_championships_singapore: 'Stamp (Championships Singapore)',
  stamp_championships_philippines: 'Stamp (Championships Philippines)',
  staff_championships_malaysia: 'Staff (Championships Malaysia)',
  staff_championships_singapore: 'Staff (Championships Singapore)',
  staff_championships_philippines: 'Staff (Championships Philippines)',
  top_8_championships_malaysia: 'Top 8 (Championships Malaysia)',
  top_8_championships_singapore: 'Top 8 (Championships Singapore)',
  top_8_championships_philippines: 'Top 8 (Championships Philippines)',
  champion_championships_malaysia: 'Champion (Championships Malaysia)',
  champion_championships_singapore: 'Champion (Championships Singapore)',
  champion_championships_philippines: 'Champion (Championships Philippines)',
  stamp_philippines_league_regional: 'Stamp (Philippines League Regional)',
  stamp_singapore_league_regional: 'Stamp (Singapore League Regional)',
  stamp_pokemon_tcg_beginner_s_session: "Stamp (Pokémon TCG Beginner's Session)",
  holo_acid_wash: 'Holo Acid Wash',
  stamp_malaysia_league_regional: 'Stamp (Malaysia League Regional)',
  stamp_hong_kong_en_league_regional: 'Stamp (Hong Kong EN League Regional)',
  holo_line: 'Holo Line',
  holo_star: 'Holo Star',
  stamp_set_logo: 'Stamp (Set Logo)',
  without_stamp: 'Without stamp',
  holo_confetti: 'Holo Confetti',
  stamp_eb_games_canada: 'Stamp (EB Games Canada)',
  cosmos_reverse: 'Cosmos Reverse',
  stamp_world_championships_2024: 'Stamp (World Championships 2024)',
  stamp_7_eleven: 'Stamp (7-Eleven)',
  stamp_rain_city_showcase: 'Stamp (Rain City Showcase)',
  stamp_premier_ball_league: 'Stamp (Premier Ball League)',
  stamp_great_ball_league: 'Stamp (Great Ball League)',
  stamp_ultra_ball_league: 'Stamp (Ultra Ball League)',
  stamp_horizons_the_series: 'Stamp (Horizons The Series)',
  stamp_premier_ball_league_judge: 'Stamp (Premier Ball League Judge)',
  alternative_pokedex_description: 'Alternative Pokédex description',
  yellow_double_star_rarity_special_illustration_rare:
    'Yellow Double Star Rarity (Special Illustration Rare)',
  stamp_master_ball_league: 'Stamp (Master Ball League)',
  stamp_master_ball_league_judge: 'Stamp (Master Ball League Judge)',
  top_4_professor_program: 'Top 4 (Professor Program)',
  stamp_thank_you: 'Stamp (Thank You)',
  stamp_set_logo_right: 'Stamp (Set Logo Right)',
  stamp_set_logo_left: 'Stamp (Set Logo Left)',
  stamp_asia_promo: 'Stamp (Asia Promo)',
  stamp_trick_or_trade: 'Stamp (Trick or Trade)',
  gold_signature: 'Gold Signature',
  finalist_professor_program: 'Finalist (Professor Program)',
  stamp_fossil_museum: 'Stamp (Fossil Museum)',
  stamp_pokemonxp: 'Stamp (PokémonXP)',
  stamp_what_s_your_favorite: "Stamp (What's Your Favorite?)",
};

/** Short badge text, e.g. "R", "PB", "MB" -- see features.md's badge
 * conventions (R×N / PB×N / MB×N / ...). */
export const VARIANT_BADGES: Record<VariantType, string> = {
  standard: '',
  reverse: 'R',
  reverse_pokeball: 'PB',
  reverse_friendball: 'FB',
  reverse_loveball: 'LB',
  reverse_duskball: 'DB',
  reverse_quickball: 'QB',
  reverse_rocketball: 'RB',
  reverse_masterball: 'MB',
  winner_promo: 'V7',
  stamp_league: 'V12',
  stamp_professor_program: 'V13',
  stamp_regional_championships: 'V21',
  stamp_pokemon_day: 'V23',
  stamp_league_cup: 'V33',
  stamp_euic: 'V34',
  stamp_ocic: 'V35',
  stamp_laic: 'V36',
  stamp_naic: 'V37',
  holo_mirage: 'V38',
  holo_cosmos: 'HC',
  non_holo: 'V48',
  stamp_pokemon_tcg_gym: 'V49',
  text_error_before_errata: 'V51',
  staff_regional_championships: 'V55',
  staff_prerelease: 'V56',
  staff_league_cup: 'V63',
  staff_euic: 'V64',
  staff_ocic: 'V65',
  staff_laic: 'V66',
  staff_naic: 'V67',
  holo_mirror: 'V68',
  holo_cracked_ice: 'V71',
  holo_sheen: 'V74',
  '1st_place_league_challenge': 'V77',
  '2nd_place_league_challenge': 'V78',
  '3rd_place_league_challenge': 'V79',
  '4th_place_league_challenge': 'V80',
  holo_water_web: 'V81',
  top_8_euic: 'V82',
  top_8_ocic: 'V83',
  top_8_laic: 'V84',
  top_8_naic: 'V85',
  champion_euic: 'V86',
  champion_ocic: 'V87',
  champion_laic: 'V88',
  champion_naic: 'V89',
  holo_sequin: 'V90',
  stamp_gamestop: 'V97',
  stamp_eb_games: 'V98',
  stamp_25th_anniversary: 'V101',
  stamp_play_pokemon: 'V102',
  ditto_sticker: 'V104',
  with_pogo_code: 'V105',
  stamp_pokemon_center: 'V107',
  stamp_iono_s_gadgets: 'V110',
  metal: 'V111',
  champion_professor_program: 'V112',
  top_8_professor_program: 'V113',
  staff_professor_program: 'V114',
  worlds_staff: 'V115',
  worlds_top_thirty_two: 'V116',
  worlds_top_sixteen: 'V117',
  worlds_quarter_finalist: 'V118',
  worlds_semi_finalist: 'V119',
  worlds_finalist: 'V120',
  worlds_champion: 'V121',
  stamp_asia_championship_series: 'V122',
  stamp_pokemon_together: 'V123',
  top_8_championships_hong_kong_en: 'V124',
  champion_championships_hong_kong_en: 'V125',
  staff_championships_hong_kong_en: 'V126',
  stamp_championships_hong_kong_en: 'V127',
  stamp_championships_malaysia: 'V128',
  stamp_championships_singapore: 'V129',
  stamp_championships_philippines: 'V130',
  staff_championships_malaysia: 'V131',
  staff_championships_singapore: 'V132',
  staff_championships_philippines: 'V133',
  top_8_championships_malaysia: 'V134',
  top_8_championships_singapore: 'V135',
  top_8_championships_philippines: 'V136',
  champion_championships_malaysia: 'V137',
  champion_championships_singapore: 'V138',
  champion_championships_philippines: 'V139',
  stamp_philippines_league_regional: 'V140',
  stamp_singapore_league_regional: 'V141',
  stamp_pokemon_tcg_beginner_s_session: 'V142',
  holo_acid_wash: 'V150',
  stamp_malaysia_league_regional: 'V151',
  stamp_hong_kong_en_league_regional: 'V152',
  holo_line: 'V153',
  holo_star: 'V154',
  stamp_set_logo: 'V159',
  without_stamp: 'V177',
  holo_confetti: 'V178',
  stamp_eb_games_canada: 'V179',
  cosmos_reverse: 'V181',
  stamp_world_championships_2024: 'V183',
  stamp_7_eleven: 'V184',
  stamp_rain_city_showcase: 'V185',
  stamp_premier_ball_league: 'V186',
  stamp_great_ball_league: 'V187',
  stamp_ultra_ball_league: 'V188',
  stamp_horizons_the_series: 'V189',
  stamp_premier_ball_league_judge: 'V190',
  alternative_pokedex_description: 'V191',
  yellow_double_star_rarity_special_illustration_rare: 'V193',
  stamp_master_ball_league: 'V203',
  stamp_master_ball_league_judge: 'V204',
  top_4_professor_program: 'V205',
  stamp_thank_you: 'V206',
  stamp_set_logo_right: 'V208',
  stamp_set_logo_left: 'V209',
  stamp_asia_promo: 'V210',
  stamp_trick_or_trade: 'V211',
  gold_signature: 'V212',
  finalist_professor_program: 'V220',
  stamp_fossil_museum: 'V221',
  stamp_pokemonxp: 'V224',
  stamp_what_s_your_favorite: 'V229',
};

export interface CardCatalogVariant {
  variant_type: VariantType;
  /** Scraped independently per language (pokecardex hosts separate FR/US
   * scans) -- pick by the account's language preference, same convention as
   * card_catalog.name vs. display_name. Either may be null. */
  image_path_fr: string | null;
  image_path_us: string | null;
}

export interface CardVariant {
  variant_type: VariantType;
  quantity: number;
  /** The variant's own scan (from card_catalog_variants), null for
   * 'standard' -- see CardCatalogVariant.image_path_fr/us. */
  image_path_fr: string | null;
  image_path_us: string | null;
}

export interface Card {
  id: number;
  catalog_id: number;
  variants: CardVariant[];
  /** Total quantity summed across variants -- see data-model.md's
   * "Computed Values". */
  quantity: number;
  created_at: string;
  name: string;
  set_name: string;
  set_code: string;
  card_number: string;
  image_path: string;
  supertype: string | null;
  rarity: string | null;
  series: string | null;
  card_count: number | null;
  release_date: string | null;
  allocated: number;
  /** Copies allocated to decks by exact print type. */
  allocated_variants: Partial<Record<VariantType, number>>;
  available: number;
  decks: CardDeckUsage[];
}

export interface CardPage {
  total: number;
  page: number;
  page_size: number;
  /** Sum of `quantity` across every card matching the current filters, not
   * just this page -- see data-model.md's "Computed Values". */
  total_quantity: number;
  /** Sum of `quantity` across the whole collection, ignoring filters. */
  collection_total_quantity: number;
  items: Card[];
}

export interface SetOption {
  set_code: string;
  set_name: string;
}

/** Distinct values for the Collection page's filter dropdowns, computed
 * over the whole collection regardless of any active filter -- see
 * features.md's "Search & filter the collection". */
export interface CardFilterOptions {
  sets: SetOption[];
  /** Raw card_catalog.rarity values -- reduce through rarityCategories()
   * before showing, same as before this moved server-side. */
  rarities: string[];
  owned_variant_types: VariantType[];
}

export interface CardCreate {
  catalog_id: number;
  variant_type?: VariantType;
  quantity?: number;
  /** Fans out into one card_variant_quantities row per variant the card
   * has, each at `quantity` -- see features.md's "Add to collection" ("Add
   * all variants" checkbox). */
  all_variants?: boolean;
}

export interface CardUpdate {
  variant_type: VariantType;
  /** 0 deletes this variant (and the whole card if it was the last one) --
   * see data-model.md's `card_variant_quantities`. */
  quantity: number;
}

export interface CardCatalogNameUpdate {
  name: string;
}

export interface CardBulkAddItem {
  catalog_id: number;
  variant_type?: VariantType;
  quantity: number;
  all_variants?: boolean;
}

export interface CardBulkAddRequest {
  items: CardBulkAddItem[];
  deck_id?: number | null;
}

export interface CollectionWipeResult {
  deleted_cards: number;
  deleted_decks: number;
}

export interface CollectionImportResult {
  imported: number;
  imported_quantity: number;
}

export interface CollectionHistoryEntry {
  id: number;
  catalog_id: number;
  variant_type: VariantType;
  action: 'added' | 'increased' | 'decreased' | 'removed';
  source: 'manual' | 'import';
  old_quantity: number | null;
  new_quantity: number | null;
  created_at: string;
  name: string;
  set_name: string;
  image_path: string;
}

export interface CollectionHistoryPage {
  total: number;
  page: number;
  page_size: number;
  items: CollectionHistoryEntry[];
}

export interface DecklistConvertEntry {
  quantity: number;
  matched: boolean;
  name: string;
  set_name: string | null;
  set_code: string | null;
  card_number: string | null;
  image_path: string | null;
  catalog_id: number | null;
}

export interface DecklistConvertResponse {
  detected_format: 'tcgplayer' | 'cardmarket' | null;
  converted_text: string;
  entries: DecklistConvertEntry[];
}

/** Result counters a refresh step can report -- which ones are populated
 * depends on the step (see backend/routers/catalog.py's REFRESH_STEPS). */
export interface RefreshStepResult {
  matched?: number;
  unmatched?: number;
  skipped?: number;
  copied?: number;
  linked?: number;
  failed?: number;
  french_missing?: number;
  sets_processed?: number;
  cards_upserted?: number;
  images_downloaded?: number;
  thumbnails_generated?: number;
  variants_added?: number;
  set_logos_updated?: number;
  variant_icons_downloaded?: number;
  variant_icons_unavailable?: string[];
}

/** Progress state for one refresh step (GET .../refresh/steps/{key}/status)
 * or the "run all" combo (GET .../refresh/status, key "__all__" server-side)
 * -- see backend/catalog_refresh/step_progress.py. `step`/`step_label`/
 * `step_index`/`total_steps` are only populated for the combo job, showing
 * which sub-step it's currently on. */
export interface RefreshStepStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  step: string | null;
  step_label: string | null;
  step_index: number;
  total_steps: number;
  percent: number;
  sub_done: number;
  sub_total: number;
  result: RefreshStepResult;
  error: string | null;
  last_run_at: string | null;
  last_run_result: RefreshStepResult | null;
}

/** Per-category counts for the Catalog Management page -- see
 * GET /api/cards/catalog/stats. */
export interface CatalogStats {
  total_cards: number;
  total_sets: number;
  variant_counts: Record<string, number>;
  distinct_card_names: number;
}

export const SHARE_DURATION_OPTIONS = [1, 3, 7, 30] as const;

export interface ShareCreate {
  set_code: string;
  duration_days: number;
}

export interface Share {
  id: number;
  set_code: string;
  set_name: string | null;
  token: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: 'active' | 'expired' | 'revoked';
}

export interface SharedSetCard {
  id: number;
  name: string;
  set_code: string;
  set_name: string;
  card_number: string;
  image_path: string;
  rarity: string | null;
  supertype: string | null;
  quantity_owned: number;
  variants: CardVariant[];
  /** Catalog print types this card comes in (standard/reverse/ball
   * patterns) -- same shape CardCatalogEntry.variants uses, backs the "show
   * variants" exploded tile grid. */
  print_variants: CardCatalogVariant[];
}

export interface SharedSet {
  set_code: string;
  set_name: string;
  card_count: number | null;
  release_date: string | null;
  expires_at: string;
  cards: SharedSetCard[];
}

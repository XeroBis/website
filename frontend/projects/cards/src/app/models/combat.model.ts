import { VariantType } from './card.model';

export type CombatWinner = 'a' | 'b';

export interface CombatSnapshotCard {
  card_id: number;
  variant_type: VariantType;
  quantity_in_deck: number;
  name: string;
  set_name: string;
  image_path: string;
  /** The print's own scan (viewer's language first); null for `standard`
   * or a print with no scan, which show `image_path` and the print badge. */
  variant_image_path?: string | null;
  supertype: string | null;
}

export interface Combat {
  id: number;
  deck_a_id: number | null;
  deck_a_name: string;
  player_a_id: number;
  player_a_pseudo: string | null;
  deck_b_id: number | null;
  deck_b_name: string;
  player_b_id: number;
  player_b_pseudo: string | null;
  winner: CombatWinner;
  loser_score: number;
  played_at: string;
  created_at: string;
  deck_a_snapshot: CombatSnapshotCard[];
  deck_b_snapshot: CombatSnapshotCard[];
}

export interface CombatCreate {
  deck_a_id: number;
  player_a_id: number;
  deck_b_id: number;
  player_b_id: number;
  winner: CombatWinner;
  loser_score: number;
  played_at: string;
}

export interface CombatUpdate extends Omit<CombatCreate, 'deck_a_id' | 'deck_b_id'> {
  deck_a_id: number | null;
  deck_b_id: number | null;
}

export interface CombatExportItem {
  deck_a_name: string;
  player_a_pseudo: string | null;
  deck_b_name: string;
  player_b_pseudo: string | null;
  winner: CombatWinner;
  loser_score: number;
  played_at: string;
  deck_a_snapshot: CombatSnapshotCard[];
  deck_b_snapshot: CombatSnapshotCard[];
}

export interface CombatExportAll {
  combats: CombatExportItem[];
}

export interface CombatWipeResult {
  deleted_combats: number;
}

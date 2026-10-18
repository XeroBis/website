import { VariantType } from '../models/card.model';

/** Original Pokécardex badges, cached by the variant-symbol refresh step. */
export function variantIconUrl(variant: VariantType): string {
  const extension = variant === 'standard' || variant === 'reverse' ? 'svg' : 'png';
  return `/api/cards/public/variant-icons/${variant}.${extension}`;
}

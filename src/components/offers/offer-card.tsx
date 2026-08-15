import Image from "next/image";

import { ReserveOfferButton } from "@/components/reservation/reserve-offer-button";
import type { OfferSnapshotItem } from "@/lib/repositories/offer-read";

const fitDisclaimer =
  "Preview shows appearance and styling, not guaranteed physical fit. Check the garment measurements before reserving.";

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function centimeters(tenths: number): string {
  return `${(tenths / 10).toFixed(1).replace(/\.0$/, "")} cm`;
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

interface OfferCardProps {
  offer: OfferSnapshotItem;
  onImageExpired: () => void;
}

export function OfferCard({ offer, onImageExpired }: OfferCardProps) {
  const ready = offer.status === "ready" && offer.resultImageUrl;
  const failed = offer.status === "failed";

  return (
    <article className={`offer-card offer-card--${offer.status}`}>
      <div className="offer-image-stage">
        {ready ? (
          <Image
            className="offer-image offer-image--result"
            src={offer.resultImageUrl!}
            alt={`Virtual try-on preview for ${offer.title}`}
            width={800}
            height={1000}
            unoptimized
            loading="eager"
            onError={onImageExpired}
          />
        ) : (
          <Image
            className="offer-image"
            src={offer.originalImageUrl}
            alt={`${offer.title} original garment`}
            width={800}
            height={1000}
            unoptimized
            loading="eager"
            onError={onImageExpired}
          />
        )}
        {ready && (
          <Image
            className="offer-original-thumb"
            src={offer.originalImageUrl}
            alt={`${offer.title} original garment`}
            width={136}
            height={168}
            unoptimized
            onError={onImageExpired}
          />
        )}
        <span className="match-score">{Math.round(offer.scoreBasisPoints / 100)}% match</span>
      </div>

      <div className="offer-card__body">
        <div className="offer-card__heading">
          <div>
            <p className="offer-provider">
              {offer.provider.displayName} · {label(offer.provider.providerType)}
            </p>
            <h2>{offer.title}</h2>
          </div>
          <p className="offer-price">
            <strong>{money(offer.rentalPriceCents)}</strong>
            <span> rental</span>
          </p>
        </div>

        {offer.status === "matched" && <p className="preview-state">Preview queued</p>}
        {offer.status === "generating" && <p className="preview-state">Preparing your preview</p>}
        {failed && (
          <p className="preview-state preview-state--failed">
            Preview unavailable—garment can still be reviewed
          </p>
        )}

        <dl className="offer-facts">
          <div><dt>Size</dt><dd>{offer.sizeLabel}</dd></div>
          <div><dt>Condition</dt><dd>{label(offer.condition)}</dd></div>
          <div><dt>Deposit</dt><dd>{money(offer.depositDisplayCents)} displayed</dd></div>
          <div><dt>Pickup</dt><dd>{offer.pickupMethod}</dd></div>
          <div><dt>Area</dt><dd>{label(offer.distanceBand)}</dd></div>
          <div><dt>Category</dt><dd>{label(offer.garmentCategory)}</dd></div>
        </dl>

        <details className="offer-details">
          <summary>Measurements and match details</summary>
          <dl className="measurement-list">
            <div><dt>Bust</dt><dd>{centimeters(offer.measurements.bustTenthsCm)}</dd></div>
            <div><dt>Waist</dt><dd>{centimeters(offer.measurements.waistTenthsCm)}</dd></div>
            <div><dt>Hips</dt><dd>{centimeters(offer.measurements.hipsTenthsCm)}</dd></div>
            <div><dt>Length</dt><dd>{centimeters(offer.measurements.lengthTenthsCm)}</dd></div>
          </dl>
          <ul className="match-reasons">
            {offer.explanations.map((explanation) => <li key={explanation}>{explanation}</li>)}
          </ul>
        </details>

        <p className="fit-disclaimer">{fitDisclaimer}</p>
        {ready ? (
          <ReserveOfferButton offerId={offer.id} garmentTitle={offer.title} />
        ) : (
          <p className="offer-action-note">
            {failed ? "Review the garment details while the preview is unavailable." : "This card will update automatically."}
          </p>
        )}
      </div>
    </article>
  );
}

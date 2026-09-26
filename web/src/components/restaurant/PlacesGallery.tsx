/**
 * A horizontal strip of Google photos, with the per-photo attribution Google's
 * Places terms require whenever the content is shown off a Google map. Renders
 * nothing when there are no photos — the parent decides whether to show a
 * placeholder instead, this component only ever draws the gallery itself.
 */

import type { PlacePhotoView } from "../../api/viewmodel";
import { useI18n } from "../../i18n/I18nProvider";

interface PlacesGalleryProps {
  name: string;
  photos: PlacePhotoView[];
}

export function PlacesGallery({ name, photos }: PlacesGalleryProps) {
  const { t } = useI18n();
  if (photos.length === 0) return null;

  return (
    <section className="gallery" aria-label={t.restaurant.gallery.title}>
      <div className="gallery__head">
        <span className="gallery__eyebrow">{t.restaurant.gallery.title}</span>
        <span className="gallery__count">{t.restaurant.gallery.count(photos.length)}</span>
      </div>
      <div className="gallery__strip">
        {photos.map((photo, position) => (
          <figure className="gallery__item" key={photo.index}>
            <img
              className="gallery__photo"
              src={photo.url}
              alt={`${name} — ${position + 1}/${photos.length}`}
              loading="lazy"
            />
            {photo.attributions.length > 0 && (
              <figcaption className="gallery__credit">
                {photo.attributions.map((attribution, index) => (
                  <span key={`${photo.index}-${index}`}>
                    {index > 0 ? " · " : ""}
                    {attribution.uri ? (
                      <a href={attribution.uri} target="_blank" rel="noreferrer">
                        {attribution.display_name}
                      </a>
                    ) : (
                      attribution.display_name
                    )}
                  </span>
                ))}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      <p className="gallery__caption">{t.restaurant.gallery.caption}</p>
    </section>
  );
}

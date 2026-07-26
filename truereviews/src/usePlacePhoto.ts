import { useCallback, useEffect, useRef, useState } from 'react';
import { findPhoto, type PlacePhoto } from './lib/photos';
import type { Place } from './lib/types';

/**
 * The photo for a place, looked up only once the card is actually about to be
 * seen. Most places have none — that is the normal case — so the caller keeps
 * its category glyph underneath and treats a photo as a layer on top: if the
 * lookup finds nothing, or the file 404s, the card still looks finished.
 *
 * The seeded `place.image` wins immediately and costs no request.
 */
export function usePlacePhoto(place: Place): {
  ref: (el: HTMLElement | null) => void;
  photo: PlacePhoto | null;
  onError: () => void;
} {
  const [photo, setPhoto] = useState<PlacePhoto | null>(
    place.image ? { url: place.image, credit: '', source: '' } : null,
  );
  const asked = useRef(false);
  const node = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setPhoto(place.image ? { url: place.image, credit: '', source: '' } : null);
    asked.current = false;
  }, [place.osmRef, place.image]);

  const look = useCallback(() => {
    if (asked.current || place.image) return;
    asked.current = true;
    void findPhoto({
      osmRef: place.osmRef,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      category: place.category,
    }).then((p) => p && setPhoto(p));
  }, [place.osmRef, place.image, place.name, place.lat, place.lon, place.category]);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      node.current = el;
      if (!el || asked.current || place.image) return;
      if (typeof IntersectionObserver === 'undefined') {
        look();
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            look();
          }
        },
        { rootMargin: '200px' },
      );
      io.observe(el);
    },
    [look, place.image],
  );

  // A dead URL must never leave an empty frame: drop back to the glyph.
  const onError = useCallback(() => setPhoto(null), []);

  return { ref, photo, onError };
}

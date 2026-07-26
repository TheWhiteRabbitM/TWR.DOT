/** A real-world place, anchored to its OpenStreetMap reference. */
export interface Place {
  /** On-chain key (hash of osmRef). For the demo this equals osmRef. */
  key: string;
  /** Stable OSM reference, e.g. "node/240109189". */
  osmRef: string;
  name: string;
  category: string;
  address: string;
  lat: number;
  lon: number;
  emoji: string;
  /** Photo URL (Wikimedia/OSM `image` tag) when the place has one. */
  image?: string;
  /** Average of verified (Full-tier) ratings. */
  avgFull: number;
  fullCount: number;
  /** Provisional (Lite-tier) ratings, disclosed separately. */
  liteCount: number;
}

/** One review of a place. */
export interface Review {
  /** Reviewer's personhood alias in this app's context. */
  alias: string;
  rating: number;
  /** 1 = Lite (provisional), 2 = Full (verified). */
  tier: number;
  at: number;
  body: string;
}

export interface PlaceDetail {
  place: Place;
  reviews: Review[];
  /** Rating the current account already left here (0 if none). */
  yourRating: number;
  /** Distribution counts for 1..5 stars (verified + lite together). */
  histogram: [number, number, number, number, number];
}

/** The data layer — one shape for both the live chain and the demo. */
export interface ReviewsDriver {
  readonly demo: boolean;
  /** Personhood tier of the current account (0/1/2). */
  tier(): number;
  recent(): Promise<Place[]>;
  detail(key: string): Promise<PlaceDetail>;
  /** Look up businesses by free text (OpenStreetMap). */
  search(query: string): Promise<Place[]>;
  /** Post a review. Returns the updated detail. */
  review(place: Place, rating: number, body: string): Promise<PlaceDetail>;
  /** The current account's own reviews, newest first. */
  mine(): Promise<{ place: Place; review: Review }[]>;
}

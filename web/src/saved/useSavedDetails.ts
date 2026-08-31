/**
 * Re-asks the API for every saved place, for whichever saved screen needs it.
 *
 * A snapshot is what the app said when the place was saved; it is never used as an
 * answer. Both saved screens re-ask and render *that* answer, and compare the two
 * only to notice a change. When every request fails we are offline: the snapshot is
 * all we have, and the screens say so rather than showing a stale verdict as current.
 */

import { useEffect, useState } from "react";
import { kashrootApi } from "../api";
import type { ProfileRequest } from "../api/types";
import type { DetailView } from "../api/viewmodel";

export type DetailMap = Record<string, DetailView | undefined>;

export function useSavedDetails(placeIds: string[], profile: ProfileRequest) {
  const [details, setDetails] = useState<DetailMap>({});
  const [offline, setOffline] = useState(false);
  const key = placeIds.join(",");
  const profileKey = JSON.stringify(profile);

  useEffect(() => {
    if (placeIds.length === 0) {
      setDetails({});
      setOffline(false);
      return;
    }
    const controller = new AbortController();
    let failures = 0;
    void Promise.all(
      placeIds.map((id) =>
        kashrootApi
          .getRestaurant(id, profile, undefined, controller.signal)
          .then((detail) => [id, detail] as const)
          .catch(() => {
            failures += 1;
            return [id, undefined] as const;
          }),
      ),
    ).then((entries) => {
      if (controller.signal.aborted) return;
      setDetails(Object.fromEntries(entries));
      setOffline(failures === placeIds.length);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, profileKey]);

  return { details, offline };
}

import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse, Privilege } from '../models/auth.models';
import { matchesRoute } from '../utils/route-match';

/** The catalogue is the same for every user, so it is kept across sign-ins for an instant start. */
const CATALOG_KEY = 'onehostel_privileges';

/**
 * The privilege catalogue (GET /access/privileges) and the privToken check. A privToken has one character
 * per privilege bit, '1' where granted; the gateway checks the same bit on every API call
 * (PrivTokens.hasBit in onehostel-common), so hiding a page here and refusing its API there always agree.
 *
 * Stateless about the user: AuthService passes the signed-in user's token in.
 */
@Injectable({ providedIn: 'root' })
export class PrivilegeService {
  private readonly url = `${environment.apiUrl}/access/privileges`;

  /** The catalogue, or null until it has been loaded once. */
  readonly catalog = signal<Privilege[] | null>(readStoredCatalog());

  constructor(private http: HttpClient) {}

  /** Fetches the catalogue (signed in only). On failure the stored one stays in use. */
  load(): Observable<Privilege[] | null> {
    return this.http.get<ApiResponse<Privilege[]>>(this.url).pipe(
      map((res) => (res.success && res.responseObject ? res.responseObject : null)),
      tap((privileges) => {
        if (!privileges) return;
        this.catalog.set(privileges);
        try {
          localStorage.setItem(CATALOG_KEY, JSON.stringify(privileges));
        } catch {
          // Storage blocked: the catalogue is fetched again on the next start
        }
      }),
      catchError(() => of(this.catalog())),
    );
  }

  /** Whether the token grants the privilege. Unknown codes are not granted. */
  has(token: string | undefined, code: string): boolean {
    const privilege = this.catalog()?.find((p) => p.code === code);
    return !!privilege && hasBit(token, privilege.bit);
  }

  /**
   * Whether the token opens a page: true or false when some privilege covers the route, null when none
   * does (Dashboard, Profile: open to every signed-in user) or the catalogue has not been loaded yet.
   */
  routeAccess(token: string | undefined, route: string): boolean | null {
    const covering = this.catalog()?.filter((p) => p.uiRoutes.some((base) => matchesRoute(route, base)));
    if (!covering?.length) return null;
    return covering.some((p) => hasBit(token, p.bit));
  }
}

/** True only when position bit-1 exists and is '1' (PrivTokens.hasBit in onehostel-common). */
export function hasBit(token: string | undefined, bit: number): boolean {
  return !!token && bit >= 1 && bit <= token.length && token.charAt(bit - 1) === '1';
}

function readStoredCatalog(): Privilege[] | null {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    return raw ? (JSON.parse(raw) as Privilege[]) : null;
  } catch {
    return null;
  }
}

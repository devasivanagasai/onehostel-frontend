import { Directive, Input, TemplateRef, ViewContainerRef, effect, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { PrivilegeService } from '../../core/services/privilege.service';

/**
 * Renders its element only when the signed-in user holds the privilege (one code, or any of several):
 *
 *   <button *ohPrivilege="'ROOMS_MANAGE'">Add room</button>
 *   <div *ohPrivilege="['FEES_MANAGE', 'FEES_VIEW']">...</div>
 *
 * Hiding a button is only for the user's convenience: the gateway checks the same bit on the API call.
 */
@Directive({ selector: '[ohPrivilege]', standalone: true })
export class PrivilegeDirective {
  private readonly auth = inject(AuthService);
  private readonly privileges = inject(PrivilegeService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);

  private readonly codes = signal<string[]>([]);
  private shown = false;

  @Input({ required: true }) set ohPrivilege(value: string | string[]) {
    this.codes.set(Array.isArray(value) ? value : [value]);
  }

  constructor() {
    // Re-evaluated when the codes, the user or the catalogue change (it may arrive after the first render)
    effect(() => {
      this.auth.user();
      this.privileges.catalog();
      const allowed = this.codes().some((code) => this.auth.hasPrivilege(code));
      if (allowed && !this.shown) this.container.createEmbeddedView(this.template);
      if (!allowed && this.shown) this.container.clear();
      this.shown = allowed;
    });
  }
}

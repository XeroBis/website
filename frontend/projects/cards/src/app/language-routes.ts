import { Injectable } from '@angular/core';
import { BaseRouteReuseStrategy } from '@angular/router';
/** Reloading the same route after a language change must refetch server display fields. */
@Injectable()
export class CardsRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(): boolean {
    return false;
  }
}

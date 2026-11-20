import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { flushMe, setup } from '../testing';
import { DialogHost, Dialogs } from './dialogs';

describe('Dialogs', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<DialogHost>;
  let el: HTMLElement;
  let dialogs: Dialogs;

  beforeEach(async () => {
    http = setup();
    fixture = TestBed.createComponent(DialogHost);
    flushMe(http);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
    dialogs = TestBed.inject(Dialogs);
  });
  afterEach(() => http.verify());

  const dialog = () => el.querySelector('dialog') as HTMLDialogElement;
  const confirmButton = () =>
    el.querySelector('[data-testid="dialog-confirm"]') as HTMLButtonElement;
  const cancelButton = () => el.querySelector('[data-testid="dialog-cancel"]') as HTMLButtonElement;

  it('asks with the translated title, message and buttons, and resolves true on confirm', async () => {
    expect(dialog().open).toBe(false);
    const answer = dialogs.confirm({
      title: 'entry.remove',
      message: 'entry.confirmRemove',
      params: { title: 'Dune' },
      confirm: 'dialog.remove',
      danger: true,
    });
    await fixture.whenStable();
    expect(dialog().open).toBe(true);
    expect(el.querySelector('.dialog-title')?.textContent).toBe('Retirer de la bibliothèque');
    expect(el.querySelector('.dialog-message')?.textContent).toBe(
      'Retirer « Dune » de votre bibliothèque ? Ses sessions, sa note et ses notes seront supprimées.',
    );
    expect(cancelButton().textContent?.trim()).toBe('Annuler');
    expect(confirmButton().textContent?.trim()).toBe('Retirer');
    expect(confirmButton().classList).toContain('danger-solid');

    confirmButton().click();
    expect(await answer).toBe(true);
    await fixture.whenStable();
    expect(dialog().open).toBe(false);
  });

  it('resolves false on Cancel, Escape or a click on the backdrop', async () => {
    const options = { title: 'series.delete', confirm: 'dialog.delete' };

    let answer = dialogs.confirm(options);
    await fixture.whenStable();
    cancelButton().click();
    expect(await answer).toBe(false);

    answer = dialogs.confirm(options);
    await fixture.whenStable();
    dialog().dispatchEvent(new Event('cancel'));
    expect(await answer).toBe(false);

    answer = dialogs.confirm(options);
    await fixture.whenStable();
    dialog().click();
    expect(await answer).toBe(false);
  });

  it('prompts for a trimmed name, which is required', async () => {
    const answer = dialogs.prompt({
      title: 'dialog.newSeries',
      label: 'library.newSeriesPrompt',
      value: 'Naruto',
      confirm: 'dialog.create',
    });
    await fixture.whenStable();
    const input = el.querySelector('.dialog-field input') as HTMLInputElement;
    expect(el.querySelector('.dialog-field .label')?.textContent).toBe('Nom de la série');
    expect(input.value).toBe('Naruto');

    input.value = '  ';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(confirmButton().disabled).toBe(true);

    input.value = ' Naruto Shippuden ';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    confirmButton().click();
    expect(await answer).toBe('Naruto Shippuden');
  });

  it('cancels a prompt to null', async () => {
    const answer = dialogs.prompt({
      title: 'dialog.newSeries',
      label: 'entry.newSeriesPrompt',
      confirm: 'dialog.create',
    });
    await fixture.whenStable();
    cancelButton().click();
    expect(await answer).toBeNull();
  });
});

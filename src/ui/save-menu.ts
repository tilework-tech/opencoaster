import type { SaveSlotMeta, SlotStore } from '../save/slot-store';
import { button, element, fileChooser } from './dom';
import { slotRow } from './slot-list';

export interface SaveMenuActions {
  /** Saves the running game under this id and name, replacing any slot with the same id. */
  save(id: string, name: string): Promise<void>;
  load(slot: SaveSlotMeta): Promise<void>;
  remove(slot: SaveSlotMeta): Promise<void>;
  exportFile(): Promise<void>;
  importFile(file: File): Promise<void>;
  backToTitle(): void;
}

export interface SaveMenuContext {
  scenarioName: string;
  defaultSlotName: string;
}

/** In-game menu over the running park: save to a slot, load, export/import a file, quit to title. */
export class SaveMenu {
  private readonly root = element('div', 'save-menu');
  private readonly panel = element('div', 'save-panel');
  private readonly message = element('p', 'save-message');
  private readonly chooser = fileChooser(
    (file) => void this.run(() => this.actions.importFile(file), 'Imported save file.'),
  );
  private context: SaveMenuContext = { scenarioName: '', defaultSlotName: '' };

  constructor(
    parent: HTMLElement,
    private readonly store: SlotStore,
    private readonly actions: SaveMenuActions,
  ) {
    this.root.setAttribute('aria-label', 'Game menu');
    this.root.hidden = true;
    this.root.append(this.panel, this.chooser);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(context: SaveMenuContext): void {
    this.context = context;
    this.root.hidden = false;
    this.message.textContent = '';
    void this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  private async render(): Promise<void> {
    let saves: SaveSlotMeta[] = [];
    try {
      saves = await this.store.list();
    } catch (err) {
      this.message.textContent = `Saved games are unavailable: ${(err as Error).message}`;
    }
    const nameInput = element('input', 'save-name');
    nameInput.type = 'text';
    nameInput.value = this.context.defaultSlotName;
    nameInput.setAttribute('aria-label', 'Save name');
    const list = element('div', 'slot-list');
    list.append(
      ...(saves.length === 0
        ? [element('p', 'slot-empty', 'No saved games yet.')]
        : saves.map((slot) =>
            slotRow(slot, this.context.scenarioName, {
              load: (s) => void this.run(() => this.actions.load(s), 'Game loaded.'),
              overwrite: (s) => void this.run(() => this.actions.save(s.id, s.name), 'Game saved.'),
              remove: (s) => void this.run(() => this.actions.remove(s), 'Save deleted.'),
            }),
          )),
    );
    const saveNew = element('div', 'save-new');
    saveNew.append(
      nameInput,
      button(
        'Save to new slot',
        () =>
          void this.run(
            () =>
              this.actions.save(
                crypto.randomUUID(),
                nameInput.value.trim() || this.context.defaultSlotName,
              ),
            'Game saved.',
          ),
      ),
    );
    const files = element('div', 'save-files');
    files.append(
      button(
        'Export save file',
        () => void this.run(() => this.actions.exportFile(), 'Save file downloaded.'),
      ),
      button('Import save file', () => this.chooser.click()),
      button('Back to title', () => this.actions.backToTitle(), 'menu-button secondary'),
      button('Close', () => this.close(), 'menu-button secondary'),
    );
    this.panel.replaceChildren(
      element('div', 'save-header', 'Game menu'),
      element('h3', 'save-section', 'Save'),
      saveNew,
      list,
      element('h3', 'save-section', 'Files'),
      files,
      this.message,
    );
  }

  /** Runs a menu action, reports its outcome, and refreshes the listing. */
  private async run(task: () => Promise<void>, success: string): Promise<void> {
    try {
      await task();
      this.message.textContent = success;
    } catch (err) {
      this.message.textContent = `Failed: ${(err as Error).message}`;
    }
    await this.render();
  }
}

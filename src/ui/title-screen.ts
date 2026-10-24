import type { SaveSlotMeta, SlotStore } from '../save/slot-store';
import type { ScenarioDef } from '../sim/scenario/scenario';
import { scenarioDisplayName } from '../sim/scenario/catalog';
import { button, element, fileChooser } from './dom';
import { slotRow } from './slot-list';

export interface TitleActions {
  newGame(def: ScenarioDef): void;
  sandbox(): void;
  loadSlot(slot: SaveSlotMeta): void;
  importFile(file: File): void;
}

/** Title screen: start a scenario, continue the newest save, load or import a save. */
export class TitleScreen {
  private readonly root = element('div', 'title-screen');
  private readonly panel = element('div', 'title-panel');
  private readonly message = element('p', 'title-message');
  private readonly chooser: HTMLInputElement;

  constructor(
    parent: HTMLElement,
    private readonly scenarios: readonly ScenarioDef[],
    private readonly slots: SlotStore,
    private readonly actions: TitleActions,
  ) {
    this.root.setAttribute('aria-label', 'Title screen');
    this.chooser = fileChooser((file) => actions.importFile(file));
    this.root.append(this.panel, this.chooser);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.message.textContent = '';
    void this.showMenu();
  }

  hide(): void {
    this.root.hidden = true;
  }

  showError(text: string): void {
    this.message.textContent = text;
  }

  private async showMenu(): Promise<void> {
    const saves = await this.listSaves();
    const continueButton = button('Continue', () => {
      if (saves[0]) this.actions.loadSlot(saves[0]);
    });
    continueButton.disabled = saves.length === 0;
    this.panel.replaceChildren(
      element('h1', 'title-heading', 'OpenCoaster'),
      element('p', 'title-tagline', 'Build the park, keep the guests happy, balance the books.'),
      button('New game', () => this.showScenarios()),
      button('Sandbox', () => this.actions.sandbox(), 'menu-button secondary'),
      continueButton,
      button('Load game', () => this.showSaves(saves.slice())),
      button('Import save file', () => this.chooser.click()),
      this.message,
    );
  }

  private showScenarios(): void {
    const list = element('div', 'scenario-list');
    for (const def of this.scenarios) {
      const card = element('article', 'scenario-card');
      card.append(
        element('h2', 'scenario-name', def.name),
        element('p', 'scenario-description', def.description ?? ''),
        button('Start', () => this.actions.newGame(def)),
      );
      list.append(card);
    }
    this.panel.replaceChildren(
      element('h1', 'title-heading', 'New game'),
      list,
      button('Back', () => void this.showMenu(), 'menu-button secondary'),
      this.message,
    );
  }

  private showSaves(saves: SaveSlotMeta[]): void {
    const list = element('div', 'slot-list');
    const render = () => {
      list.replaceChildren(
        ...(saves.length === 0
          ? [element('p', 'slot-empty', 'No saved games yet.')]
          : saves.map((slot) =>
              slotRow(slot, this.scenarioName(slot.scenarioId), {
                load: (s) => this.actions.loadSlot(s),
                remove: (s) => {
                  void this.slots.remove(s.id).then(() => {
                    saves.splice(saves.indexOf(s), 1);
                    render();
                  });
                },
              }),
            )),
      );
    };
    render();
    this.panel.replaceChildren(
      element('h1', 'title-heading', 'Load game'),
      list,
      button('Back', () => void this.showMenu(), 'menu-button secondary'),
      this.message,
    );
  }

  private scenarioName(id: string): string {
    return scenarioDisplayName(id);
  }

  /** Saves storage can fail (private browsing, quota); the title screen shows that instead of breaking. */
  private async listSaves(): Promise<SaveSlotMeta[]> {
    try {
      return await this.slots.list();
    } catch (err) {
      this.message.textContent = `Saved games are unavailable: ${(err as Error).message}`;
      return [];
    }
  }
}

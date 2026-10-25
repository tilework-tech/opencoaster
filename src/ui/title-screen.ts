import type { SaveSlotMeta, SlotStore } from '../save/slot-store';
import { gameDate } from '../sim/economy/calendar';
import { ObjectiveKind } from '../sim/scenario/scenario';
import type { ScenarioCategory, ScenarioDef } from '../sim/scenario/scenario';
import { scenarioDisplayName } from '../sim/scenario/catalog';
import { button, element, fileChooser } from './dom';
import { formatMoney } from './format';
import { slotRow } from './slot-list';

const SCENARIO_CATEGORIES: ReadonlyArray<{ id: ScenarioCategory; label: string }> = [
  { id: 'beginner', label: 'Beginner Parks' },
  { id: 'challenging', label: 'Challenging Parks' },
  { id: 'expert', label: 'Expert Parks' },
  { id: 'real', label: 'Real Parks' },
  { id: 'other', label: 'Other Parks' },
];

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
  private selectedCategory: ScenarioCategory = 'beginner';
  private selectedScenarioId = '';

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
    this.panel.classList.remove('scenario-panel');
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
    this.selectedCategory =
      SCENARIO_CATEGORIES.find((category) =>
        this.scenarios.some((scenario) => (scenario.category ?? 'beginner') === category.id),
      )?.id ?? 'beginner';
    this.selectedScenarioId =
      this.scenarios.find((scenario) => (scenario.category ?? 'beginner') === this.selectedCategory)
        ?.id ?? '';
    this.panel.classList.add('scenario-panel');
    this.renderScenarioSelection();
  }

  private renderScenarioSelection(): void {
    const categoryTabs = element('div', 'scenario-category-tabs');
    categoryTabs.setAttribute('role', 'tablist');
    categoryTabs.setAttribute('aria-label', 'Scenario difficulty');
    for (const category of SCENARIO_CATEGORIES) {
      const tab = button(
        category.label,
        () => {
          this.selectedCategory = category.id;
          this.selectedScenarioId =
            this.scenarios.find((scenario) => (scenario.category ?? 'beginner') === category.id)
              ?.id ?? '';
          this.renderScenarioSelection();
        },
        'scenario-category-tab',
      );
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(this.selectedCategory === category.id));
      categoryTabs.append(tab);
    }

    const scenarios = this.scenarios.filter(
      (scenario) => (scenario.category ?? 'beginner') === this.selectedCategory,
    );
    const list = element('div', 'scenario-list');
    list.setAttribute('role', 'list');
    for (const def of scenarios) {
      const card = element('article', 'scenario-card');
      card.setAttribute('role', 'listitem');
      card.classList.toggle('selected', def.id === this.selectedScenarioId);
      const choose = button(
        def.name,
        () => {
          this.selectedScenarioId = def.id;
          this.renderScenarioSelection();
        },
        'scenario-choice',
      );
      choose.setAttribute('aria-pressed', String(def.id === this.selectedScenarioId));
      card.append(
        choose,
        element('p', 'scenario-description', def.description ?? ''),
        button('Start', () => this.actions.newGame(def), 'menu-button scenario-card-start'),
      );
      list.append(card);
    }

    const selected = scenarios.find((scenario) => scenario.id === this.selectedScenarioId);
    const preview = element('section', 'scenario-preview-panel');
    if (selected) {
      preview.append(
        scenarioPreview(selected),
        element('h2', 'scenario-preview-name', selected.name),
        element('p', 'scenario-description', selected.description ?? ''),
        element('p', 'scenario-objective', objectiveText(selected)),
        element(
          'p',
          'scenario-meta',
          `${selected.mapWidth} × ${selected.mapHeight} tiles · Starting cash ${formatMoney(selected.startingCash)}`,
        ),
        button('Start', () => this.actions.newGame(selected), 'menu-button scenario-start'),
      );
    } else {
      preview.append(element('p', 'scenario-empty', 'No parks in this category yet.'));
    }

    const browser = element('div', 'scenario-browser');
    browser.append(list, preview);

    this.panel.replaceChildren(
      element('h1', 'title-heading', 'New game'),
      categoryTabs,
      browser,
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
                  this.slots
                    .remove(s.id)
                    .then(() => {
                      saves.splice(saves.indexOf(s), 1);
                      render();
                    })
                    .catch((err: Error) =>
                      this.showError(`Could not delete that save: ${err.message}`),
                    );
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

function scenarioPreview(scenario: ScenarioDef): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 240 132');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${scenario.name} scenario preview`);
  svg.classList.add('scenario-map-preview');
  const shapes: Array<[string, string, string?]> = [
    ['rect', '0 0 240 132', 'fill:#729b43'],
    ['path', 'M0 30 Q42 6 84 30 T168 26 T240 32 V0 H0Z', 'fill:#87ad52'],
    ['path', 'M0 92 Q38 70 76 95 T154 87 T240 94 V132 H0Z', 'fill:#618a3b'],
    [
      'path',
      'M145 78 Q169 58 194 74 Q218 87 212 106 Q199 123 174 112 Q157 104 145 78Z',
      'fill:#5791a4;stroke:#3b6672;stroke-width:3',
    ],
    ['path', 'M0 119 Q48 106 98 119 T193 120 T240 116', 'fill:none;stroke:#d5c18a;stroke-width:5'],
  ];
  for (const [tag, geometry, style] of shapes) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (tag === 'rect') {
      const [x, y, width, height] = geometry.split(' ');
      shape.setAttribute('x', x);
      shape.setAttribute('y', y);
      shape.setAttribute('width', width);
      shape.setAttribute('height', height);
    } else {
      shape.setAttribute('d', geometry);
    }
    const [fill, stroke, width] = (style ?? '').split(';');
    if (fill) shape.setAttribute('style', [fill, stroke, width].filter(Boolean).join(';'));
    svg.append(shape);
  }
  return svg;
}

function objectiveText(scenario: ScenarioDef): string {
  const objective = scenario.objective;
  const deadline = gameDate(objective.byTick - 1);
  const due = ` Deadline: ${deadline.monthName} year ${deadline.year}.`;
  switch (objective.kind) {
    case ObjectiveKind.Guests:
      return `Objective: attract ${objective.target} guests.${due}`;
    case ObjectiveKind.ParkValue:
      return `Objective: reach a park value of ${formatMoney(objective.target)}.${due}`;
    case ObjectiveKind.GuestsAndRating:
      return `Objective: attract ${objective.target} guests and reach a park rating of ${objective.rating}.${due}`;
    case ObjectiveKind.RepayLoanAndParkValue:
      return `Objective: repay the loan and reach a park value of ${formatMoney(objective.target)}.${due}`;
    case ObjectiveKind.MonthlyIncome:
      return `Objective: reach monthly income of ${formatMoney(objective.target)}.${due}`;
    case ObjectiveKind.QualifyingRides:
      return `Objective: build ${objective.target} qualifying rides.${due}`;
  }
}

import type { ScenarioProgress } from '../save/scenario-progress';
import { restrictionLines } from '../sim/scenario/restrictions';
import type { SaveSlotMeta, SlotStore } from '../save/slot-store';
import { LedgerCategory } from '../sim/economy/ledger';
import { ObjectiveKind } from '../sim/scenario/scenario';
import type { ScenarioCategory, ScenarioDef } from '../sim/scenario/scenario';
import { scenarioDisplayName } from '../sim/scenario/catalog';
import { button, element, fileChooser } from './dom';
import { deadlineLabel } from './objective';
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
    private readonly progress: () => ScenarioProgress = () => ({}),
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
    const completed = this.progress();
    for (const category of SCENARIO_CATEGORIES) {
      const inCategory = this.scenarios.filter(
        (scenario) => (scenario.category ?? 'beginner') === category.id,
      );
      const won = inCategory.filter((scenario) => completed[scenario.id]).length;
      const tab = button(
        inCategory.length > 0 ? `${category.label} (${won}/${inCategory.length})` : category.label,
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
      card.classList.toggle('completed', Boolean(completed[def.id]));
      const choose = button(
        def.name,
        () => {
          this.selectedScenarioId = def.id;
          this.renderScenarioSelection();
        },
        'scenario-choice',
      );
      choose.setAttribute('aria-pressed', String(def.id === this.selectedScenarioId));
      const details = element('div', 'scenario-card-details');
      details.append(
        choose,
        element('p', 'scenario-objective', objectiveText(def)),
        element('p', 'scenario-rank', scenarioRankText(def)),
        element('p', 'scenario-map-size', `Map size: ${def.mapWidth} × ${def.mapHeight} tiles`),
        element('p', 'scenario-description', def.description ?? ''),
      );
      card.append(
        scenarioPreview(def, 'scenario-card-preview'),
        details,
        ...(completed[def.id] ? [element('p', 'scenario-status', 'Completed')] : []),
        button('Start', () => this.actions.newGame(def), 'menu-button scenario-card-start'),
      );
      list.append(card);
    }

    const selected = scenarios.find((scenario) => scenario.id === this.selectedScenarioId);
    const preview = element('section', 'scenario-preview-panel');
    if (selected) {
      preview.append(
        scenarioPreview(selected, 'scenario-map-preview'),
        element('h2', 'scenario-preview-name', selected.name),
        element('p', 'scenario-description', selected.description ?? ''),
        element('p', 'scenario-objective', objectiveText(selected)),
        element('p', 'scenario-rules', scenarioRulesText(selected)),
        element('p', 'scenario-rank', scenarioRankText(selected)),
        element(
          'p',
          'scenario-status',
          completed[selected.id]
            ? `Completed ${new Date(completed[selected.id].completedAt).toLocaleDateString()}`
            : 'Not completed',
        ),
        element(
          'p',
          'scenario-map-size',
          `Map size: ${selected.mapWidth} × ${selected.mapHeight} tiles`,
        ),
        element('p', 'scenario-meta', `Starting cash ${formatMoney(selected.startingCash)}`),
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

function scenarioPreview(scenario: ScenarioDef, className: string): HTMLImageElement {
  const image = element('img', className);
  const base = `${import.meta.env.BASE_URL}scenario-previews/${encodeURIComponent(scenario.id)}`;
  image.src = `${base}@1x.png`;
  image.srcset = `${base}@2x.png 2x`;
  image.alt = `${scenario.name} scenario preview`;
  image.draggable = false;
  return image;
}

function scenarioRankText(scenario: ScenarioDef): string {
  const category = scenario.category ?? 'beginner';
  const label = `${category[0].toUpperCase()}${category.slice(1)}`;
  return `${category === 'real' || category === 'other' ? 'Category' : 'Difficulty'}: ${label}`;
}

export function objectiveText(scenario: ScenarioDef): string {
  const objective = scenario.objective;
  if (objective.kind === ObjectiveKind.HaveFun) return 'Objective: have fun. No deadline.';
  const due = ` Deadline: ${deadlineLabel(objective.byTick)}.`;
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
      return `Objective: reach ${monthlyIncomeLabel(objective.categoryMask)} of ${formatMoney(objective.target)}.${due}`;
    case ObjectiveKind.QualifyingRides:
      return `Objective: build ${objective.target} qualifying rides.${due}`;
    case ObjectiveKind.BuildRides:
      return `Objective: build ${objective.target} rides.${due}`;
    case ObjectiveKind.QualifyingCoasters:
      return `Objective: build ${objective.target} qualifying coaster types.${due}`;
    case ObjectiveKind.CompleteCoasters:
      return `Objective: build ${objective.target} complete coasters.${due}`;
    case ObjectiveKind.BestRide:
      return `Objective: have a ride with excitement of at least ${objective.target}.${due}`;
  }
}

function monthlyIncomeLabel(categoryMask: number): string {
  const foodAndDrinkMask =
    (1 << LedgerCategory.FoodDrinkSales) | (1 << LedgerCategory.FoodDrinkStock);
  if (categoryMask === 1 << LedgerCategory.RideTickets) return 'monthly ride ticket income';
  if (categoryMask === foodAndDrinkMask) return 'monthly food and drink profit';

  const categories: ReadonlyArray<[LedgerCategory, string]> = [
    [LedgerCategory.RideConstruction, 'ride construction'],
    [LedgerCategory.RideRunning, 'ride running'],
    [LedgerCategory.Land, 'land'],
    [LedgerCategory.Landscaping, 'landscaping'],
    [LedgerCategory.Admission, 'admission'],
    [LedgerCategory.RideTickets, 'ride tickets'],
    [LedgerCategory.ShopSales, 'shop sales'],
    [LedgerCategory.ShopStock, 'shop stock'],
    [LedgerCategory.FoodDrinkSales, 'food and drink sales'],
    [LedgerCategory.FoodDrinkStock, 'food and drink stock'],
    [LedgerCategory.Wages, 'wages'],
    [LedgerCategory.Marketing, 'marketing'],
    [LedgerCategory.Research, 'research'],
    [LedgerCategory.Interest, 'interest'],
  ];
  const selected = categories
    .filter(([category]) => (categoryMask & (1 << category)) !== 0)
    .map(([, label]) => label);
  return selected.length > 0 ? `monthly net from ${selected.join(', ')}` : 'monthly income';
}

/** The scenario's restrictions as the player reads them before starting. */
export function scenarioRulesText(def: ScenarioDef): string {
  const lines = restrictionLines(def.restrictions ?? {});
  return lines.length === 0 ? 'Park rules: no restrictions.' : `Park rules: ${lines.join(' ')}`;
}

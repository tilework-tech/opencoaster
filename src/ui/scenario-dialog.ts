import { ScenarioStatus } from '../sim/scenario/scenario';
import { button, element } from './dom';

export interface OutcomeActions {
  keepPlaying(): void;
  openMenu(): void;
  backToTitle(): void;
}

/** Shown once when a scenario's objective is judged. The game can continue as a sandbox either way. */
export class ScenarioDialog {
  private readonly root = element('div', 'outcome-backdrop');

  constructor(parent: HTMLElement) {
    this.root.hidden = true;
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** `status` should be Won or Lost; an Active status is ignored. */
  show(status: ScenarioStatus, scenarioName: string, actions: OutcomeActions): void {
    if (status === ScenarioStatus.Active) return;
    const won = status === ScenarioStatus.Won;
    const dialog = element('section', 'outcome-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.append(
      element('h2', 'outcome-heading', won ? 'Objective met' : 'Objective missed'),
      element(
        'p',
        'outcome-text',
        won
          ? `${scenarioName} is a success. You can keep building the park as a sandbox, or head back to the title screen.`
          : `The deadline for ${scenarioName} has passed. You can keep playing as a sandbox, load an earlier save, or head back to the title screen.`,
      ),
      button('Keep playing', actions.keepPlaying),
      button('Load or save', actions.openMenu, 'menu-button secondary'),
      button('Back to title', actions.backToTitle, 'menu-button secondary'),
    );
    this.root.replaceChildren(dialog);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

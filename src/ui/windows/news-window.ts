import { element } from '../dom';
import { formatDate } from '../format';
import type { NewsItem } from '../news';
import type { UiContext, WindowController } from '../ui-types';

export interface NewsWindowActions {
  history: () => readonly NewsItem[];
  /** Jumps to the message's subject. */
  follow: (item: NewsItem) => void;
  dismiss: (id: number) => void;
  clearAll: () => void;
}

/** Message history, newest first. Tapping a message with a location jumps there. */
export function openNewsWindow(ctx: UiContext, actions: NewsWindowActions): WindowController {
  const { window: win } = ctx.windows.open({
    id: 'news',
    title: 'Recent messages',
    kind: 'park',
    width: 340,
  });
  const clear = element('button', 'ui-button', 'Clear all');
  clear.type = 'button';
  clear.addEventListener('click', actions.clearAll);
  const list = element('ul', 'ride-list');
  list.setAttribute('aria-label', 'Recent messages');
  win.pane().append(clear, list);
  let shown = '';
  return {
    update() {
      const items = actions.history();
      const key = `${items.length}:${items[0]?.id ?? 0}`;
      if (key === shown) return;
      shown = key;
      clear.disabled = items.length === 0;
      if (items.length === 0) {
        list.replaceChildren(element('li', 'ui-help', 'No messages yet.'));
        return;
      }
      list.replaceChildren(
        ...items.map((item) => {
          const row = element('li', 'message-row');
          const b = element('button', 'list-row');
          b.type = 'button';
          b.append(
            element('span', 'list-name', item.text),
            element('span', 'list-meta', formatDate(item.tick)),
          );
          b.disabled = !item.target;
          b.addEventListener('click', () => actions.follow(item));
          const dismiss = element('button', 'message-dismiss', '×');
          dismiss.type = 'button';
          dismiss.setAttribute('aria-label', `Dismiss: ${item.text}`);
          dismiss.title = 'Dismiss';
          dismiss.addEventListener('click', () => actions.dismiss(item.id));
          row.append(b, dismiss);
          return row;
        }),
      );
    },
  };
}

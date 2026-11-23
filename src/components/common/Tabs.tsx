import {
  createContext,
  useContext,
  useRef,
  useCallback,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useState,
} from 'react';

/**
 * Lightweight, accessible Tabs primitive.
 *
 * Implements the WAI-ARIA Tabs pattern:
 *  - role="tablist" / role="tab" / role="tabpanel"
 *  - aria-selected / aria-controls / aria-labelledby
 *  - Roving tabindex (only the active tab is in the tab order)
 *  - Arrow-key navigation (Left/Right) between triggers
 *  - Home/End jump to first/last trigger
 *  - Optional `badge` prop on each trigger renders a small count chip
 *
 * No external dependency — matches the in-repo style of PassphraseModal / Toast.
 */

interface TabsContextValue {
  value: string;
  onChange: (v: string) => void;
  baseId: string;
  registerTrigger: (value: string, el: HTMLButtonElement | null) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Tabs>`);
  }
  return ctx;
}

let nextBaseId = 0;
function useUniqueId(prefix: string): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) {
    nextBaseId += 1;
    ref.current = `${prefix}-${nextBaseId}`;
  }
  return ref.current;
}

// ============================================================
// Root
// ============================================================

interface TabsProps {
  /** Controlled value (the active tab's `value` prop). */
  value: string;
  /** Called when the user selects a different tab. */
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, onChange, children, className }: TabsProps) {
  const baseId = useUniqueId('tabs');
  const triggersRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  const registerTrigger = useCallback((triggerValue: string, el: HTMLButtonElement | null) => {
    if (el) {
      triggersRef.current.set(triggerValue, el);
    } else {
      triggersRef.current.delete(triggerValue);
    }
  }, []);

  return (
    <TabsContext.Provider value={{ value, onChange, baseId, registerTrigger }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

// ============================================================
// TabsList
// ============================================================

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  useTabs('TabsList');
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const triggers = Array.from(
      (listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []),
    );
    if (triggers.length === 0) return;

    const currentIndex = triggers.findIndex(t => t.getAttribute('aria-selected') === 'true');
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    switch (e.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % triggers.length;
        break;
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = triggers.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const next = triggers[nextIndex];
    next.focus();
    next.click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={
        'flex flex-wrap items-center gap-1 bg-gray-100 dark:bg-gray-800/60 rounded-lg p-1 ' +
        (className ?? '')
      }
    >
      {children}
    </div>
  );
}

// ============================================================
// TabsTrigger
// ============================================================

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  /** Optional count chip rendered to the right of the label. */
  badge?: number | string;
  /** Extra classes applied to the badge chip. */
  badgeClassName?: string;
  className?: string;
  disabled?: boolean;
}

export function TabsTrigger({
  value,
  children,
  badge,
  badgeClassName,
  className,
  disabled,
}: TabsTriggerProps) {
  const { value: active, onChange, baseId, registerTrigger } = useTabs('TabsTrigger');
  const isActive = active === value;
  const id = `${baseId}-trigger-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  return (
    <button
      ref={(el) => registerTrigger(value, el)}
      type="button"
      role="tab"
      id={id}
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={
        'inline-flex items-center gap-2 px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md ' +
        'transition-colors duration-150 ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-hns-400 ' +
        'disabled:opacity-50 disabled:cursor-not-allowed ' +
        (isActive
          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200') +
        ' ' + (className ?? '')
      }
    >
      <span className="whitespace-nowrap">{children}</span>
      {badge !== undefined && badge !== null && (
        <span
          className={
            'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full ' +
            'text-[10px] font-semibold leading-none ' +
            (badgeClassName ??
              (isActive
                ? 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                : 'bg-gray-200/70 dark:bg-gray-700/70 text-gray-600 dark:text-gray-300'))
          }
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ============================================================
// TabsContent
// ============================================================

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
  /** When true, mount only when this tab is first activated (default). */
  lazyMount?: boolean;
}

export function TabsContent({ value, children, className, lazyMount = true }: TabsContentProps) {
  const { value: active, baseId } = useTabs('TabsContent');
  const id = `${baseId}-panel-${value}`;
  const triggerId = `${baseId}-trigger-${value}`;
  const isActive = active === value;

  // Keep mounted once visited (so input state inside isn't lost on tab switch).
  const [hasMounted, setHasMounted] = useState(isActive);
  useEffect(() => {
    if (isActive) setHasMounted(true);
  }, [isActive]);

  if (lazyMount && !hasMounted) return null;

  return (
    <div
      role="tabpanel"
      id={id}
      aria-labelledby={triggerId}
      hidden={!isActive}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}

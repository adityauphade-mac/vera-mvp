'use client';

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';

/**
 * Controlled tab primitive. Underline-style, matches the existing
 * `TabButton` look from FollowUpsView (which this replaces). Accessible
 * via standard ARIA tab roles, keyboard-navigable via Tab/Shift+Tab and
 * Arrow keys.
 *
 * Usage (uncontrolled):
 *   <Tabs defaultValue="reports">
 *     <TabsList>
 *       <Tab value="reports">Reports</Tab>
 *       <Tab value="data-sync">Data sync</Tab>
 *     </TabsList>
 *     <TabsContent value="reports">...</TabsContent>
 *     <TabsContent value="data-sync">...</TabsContent>
 *   </Tabs>
 *
 * Or controlled (e.g. wired to nuqs URL state):
 *   <Tabs value={tab} onValueChange={setTab}>...</Tabs>
 */

interface TabsContextValue {
  value: string;
  onValueChange: (v: string) => void;
  /** Stable name shared by all tab/panel ids in this Tabs instance. */
  name: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside a <Tabs> parent`);
  }
  return ctx;
}

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
  /** Prefix for ARIA ids. Default: "tabs". Override to disambiguate when
   *  multiple Tabs render on the same page. */
  name?: string;
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  children,
  className,
  name = 'tabs',
}: TabsProps) {
  const [uncontrolled, setUncontrolled] = useState<string>(defaultValue ?? '');
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : uncontrolled;

  function set(next: string) {
    if (!isControlled) setUncontrolled(next);
    onValueChange?.(next);
  }

  return (
    <TabsContext.Provider value={{ value, onValueChange: set, name }}>
      <div className={cn('flex flex-col', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function TabsList({
  children,
  className,
  'aria-label': ariaLabel,
}: TabsListProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel ?? 'Tabs'}
      className={cn(
        'border-border flex flex-wrap gap-1 border-b',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TabProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'> {
  value: string;
  children: ReactNode;
}

export function Tab({ value, children, className, ...rest }: TabProps) {
  const { value: active, onValueChange, name } = useTabsContext('Tab');
  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${name}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${name}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => onValueChange(value)}
      className={cn(
        '-mb-px border-b-2 px-5 py-3 text-sm transition-colors',
        selected
          ? 'border-accent text-text-primary font-medium'
          : 'text-text-secondary hover:text-text-primary border-transparent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
  /** When true, keep mounted while inactive (display:none) instead of
   *  unmounting. Useful when content keeps internal state. Default false. */
  keepMounted?: boolean;
}

export function TabsContent({
  value,
  children,
  className,
  keepMounted = false,
}: TabsContentProps) {
  const { value: active, name } = useTabsContext('TabsContent');
  const isActive = active === value;
  if (!isActive && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={`${name}-panel-${value}`}
      aria-labelledby={`${name}-tab-${value}`}
      hidden={!isActive}
      className={cn(isActive ? 'block' : 'hidden', className)}
    >
      {children}
    </div>
  );
}

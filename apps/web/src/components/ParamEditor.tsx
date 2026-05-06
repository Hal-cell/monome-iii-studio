import { For, Show } from 'solid-js';
import type { IntArrayParamSchema, ParamSchema } from '../recipes/types.ts';

type Props = {
  schema: ParamSchema[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
};

/**
 * Render a parameter form from a schema. Two field types: `int` and
 * `enum`. The form is uncontrolled per cell; values are owned by the
 * parent (so the recipe-switch effect can swap them in one go).
 */
export function ParamEditor(props: Props) {
  return (
    <div class="space-y-3">
      <For each={props.schema}>
        {(field) => (
          <div class="flex flex-col gap-1">
            <label class="text-[10px] uppercase tracking-wider text-neutral-500">
              {field.label}
            </label>
            <Show when={field.kind === 'int'}>
              <IntField
                field={field as Extract<ParamSchema, { kind: 'int' }>}
                value={props.values[field.key]}
                onChange={(v) => props.onChange(field.key, v)}
              />
            </Show>
            <Show when={field.kind === 'enum'}>
              <EnumField
                field={field as Extract<ParamSchema, { kind: 'enum' }>}
                value={props.values[field.key]}
                onChange={(v) => props.onChange(field.key, v)}
              />
            </Show>
            <Show when={field.kind === 'int_array'}>
              <IntArrayField
                field={field as IntArrayParamSchema}
                value={props.values[field.key]}
                onChange={(v) => props.onChange(field.key, v)}
              />
            </Show>
            <Show when={field.kind === 'int' && (field as Extract<ParamSchema, { kind: 'int' }>).help}>
              <p class="text-[10px] text-neutral-600 leading-relaxed">
                {(field as Extract<ParamSchema, { kind: 'int' }>).help}
              </p>
            </Show>
            <Show when={field.kind === 'int_array' && (field as IntArrayParamSchema).help}>
              <p class="text-[10px] text-neutral-600 leading-relaxed">
                {(field as IntArrayParamSchema).help}
              </p>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function IntField(props: {
  field: Extract<ParamSchema, { kind: 'int' }>;
  value: unknown;
  onChange: (v: number) => void;
}) {
  const current = () =>
    typeof props.value === 'number' ? props.value : props.field.default;
  return (
    <input
      type="number"
      min={props.field.min}
      max={props.field.max}
      value={current()}
      onInput={(e) => {
        const n = Number((e.currentTarget as HTMLInputElement).value);
        if (Number.isFinite(n)) props.onChange(n);
      }}
      class="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-200 font-mono focus:outline-none focus:border-neutral-600"
    />
  );
}

function IntArrayField(props: {
  field: IntArrayParamSchema;
  value: unknown;
  onChange: (next: number[]) => void;
}) {
  const length = () => props.field.length;
  const arr = () => (Array.isArray(props.value) ? (props.value as number[]) : []);
  function setIndex(i: number, n: number) {
    const cur = arr();
    const next: number[] = [];
    for (let k = 0; k < length(); k++) {
      next[k] = typeof cur[k] === 'number' ? (cur[k] as number) : props.field.default;
    }
    next[i] = n;
    props.onChange(next);
  }
  return (
    <div class="flex gap-1 flex-wrap">
      <For each={Array.from({ length: length() }, (_, i) => i)}>
        {(i) => (
          <input
            type="number"
            min={props.field.min}
            max={props.field.max}
            value={
              typeof arr()[i] === 'number'
                ? (arr()[i] as number)
                : props.field.default
            }
            onInput={(e) => {
              const n = Number((e.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(n)) setIndex(i, n);
            }}
            class="w-10 bg-neutral-900 border border-neutral-800 rounded px-1 py-1 text-xs text-neutral-200 font-mono text-center focus:outline-none focus:border-neutral-600"
            title={`row ${i}`}
          />
        )}
      </For>
    </div>
  );
}

function EnumField(props: {
  field: Extract<ParamSchema, { kind: 'enum' }>;
  value: unknown;
  onChange: (v: string) => void;
}) {
  const current = () =>
    typeof props.value === 'string' ? props.value : props.field.default;
  // Short option lists (Output: Note/CC, Polyphony: Poly/Mono,
  // Direction: 3) read fine on a single row with equal-width
  // buttons. Anything longer (the 8 scales, future >=4-option enums)
  // gets a 2-column grid so the labels don't get clipped to "Mixol…".
  const useGrid = () => props.field.options.length >= 4;
  return (
    <div class={useGrid() ? 'grid grid-cols-2 gap-1' : 'flex gap-1'}>
      <For each={props.field.options}>
        {(opt) => (
          <button
            type="button"
            class={`${useGrid() ? '' : 'flex-1 '}px-2 py-1 text-xs rounded border ${
              current() === opt.value
                ? 'border-neutral-400 bg-neutral-800 text-neutral-100'
                : 'border-neutral-800 bg-neutral-950 text-neutral-500 hover:text-neutral-300'
            }`}
            onClick={() => props.onChange(opt.value)}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );
}

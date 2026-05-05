import { For, Show } from 'solid-js';
import type { ParamSchema } from '../recipes/types.ts';

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
            <Show when={field.kind === 'int' && (field as Extract<ParamSchema, { kind: 'int' }>).help}>
              <p class="text-[10px] text-neutral-600 leading-relaxed">
                {(field as Extract<ParamSchema, { kind: 'int' }>).help}
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

function EnumField(props: {
  field: Extract<ParamSchema, { kind: 'enum' }>;
  value: unknown;
  onChange: (v: string) => void;
}) {
  const current = () =>
    typeof props.value === 'string' ? props.value : props.field.default;
  return (
    <div class="flex gap-1">
      <For each={props.field.options}>
        {(opt) => (
          <button
            type="button"
            class={`flex-1 px-2 py-1 text-xs rounded border ${
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

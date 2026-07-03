/**
 * Adaptive parameter panel.
 *
 * Renders a visualizer's ParamSpec[] as grouped, collapsible controls —
 * the studio knows NOTHING about any specific visualizer; every control
 * below is generated from the schema:
 *
 *   number          slider + live numeric input (slider only when min&max)
 *   color           color picker
 *   boolean         toggle
 *   select          dropdown
 *   vec2 / vec3     2–3 numeric inputs
 *   range           ordered [min, max] numeric pair
 *   seed            integer input + "new seed" dice button
 *
 * Extras: per-param reset (↺, shown when value differs from default),
 * tooltips from spec.description, an "advanced" visibility toggle, and
 * setValues() so randomize/mutate/presets can update every widget in
 * place without rebuilding (rebuilding would steal input focus).
 */

import type {
  ParamSpec,
  ParamValue,
  ParamValues,
  VisualizerDefinition,
} from "../visualizers/types";
import { defaultParams } from "../visualizers/types";

type OnChange = (key: string, value: ParamValue) => void;

interface Widget {
  spec: ParamSpec;
  /** Push a value into the DOM controls (no onChange fired). */
  set(value: ParamValue): void;
  row: HTMLElement;
  resetBtn: HTMLButtonElement;
}

export class ParamPanel {
  private widgets = new Map<string, Widget>();
  private defaults: ParamValues;
  private values: ParamValues;
  private showAdvanced = false;
  private root: HTMLElement;

  constructor(
    container: HTMLElement,
    private def: VisualizerDefinition,
    initial: ParamValues,
    private onChange: OnChange,
  ) {
    this.defaults = defaultParams(def);
    this.values = { ...this.defaults, ...structuredClone(initial) };
    container.innerHTML = "";
    this.root = document.createElement("div");
    this.root.className = "param-panel";
    container.appendChild(this.root);
    this.build();
  }

  /** Current values (live reference copy). */
  getValues(): ParamValues {
    return structuredClone(this.values);
  }

  /** Update all widgets in place (preset load / randomize / reset all). */
  setValues(values: ParamValues): void {
    this.values = { ...this.defaults, ...structuredClone(values) };
    for (const [key, w] of this.widgets) {
      w.set(this.values[key]);
      this.updateResetVisibility(key);
    }
  }

  // -------------------------------------------------------------------------

  private build(): void {
    // Group params by spec.group preserving first-appearance order.
    const groups = new Map<string, ParamSpec[]>();
    let anyAdvanced = false;
    for (const spec of this.def.params) {
      const g = spec.group ?? "General";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(spec);
      if (spec.advanced) anyAdvanced = true;
    }

    if (anyAdvanced) {
      const toggle = document.createElement("label");
      toggle.className = "advanced-toggle";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", () => {
        this.showAdvanced = cb.checked;
        this.applyAdvancedVisibility();
      });
      toggle.append(cb, document.createTextNode(" show advanced parameters"));
      this.root.appendChild(toggle);
    }

    for (const [groupName, specs] of groups) {
      // <details> gives collapse/expand for free; single unnamed group stays
      // headerless for visualizers that don't use groups (v1 schema).
      const useDetails = groups.size > 1 || groupName !== "General";
      let body: HTMLElement;
      if (useDetails) {
        const details = document.createElement("details");
        details.className = "param-group";
        details.open = true;
        const summary = document.createElement("summary");
        summary.textContent = groupName;
        details.appendChild(summary);
        body = document.createElement("div");
        details.appendChild(body);
        this.root.appendChild(details);
      } else {
        body = this.root;
      }
      for (const spec of specs) body.appendChild(this.buildRow(spec));
    }
    this.applyAdvancedVisibility();
  }

  private applyAdvancedVisibility(): void {
    for (const w of this.widgets.values()) {
      if (w.spec.advanced) {
        w.row.style.display = this.showAdvanced ? "" : "none";
      }
    }
  }

  private commit(key: string, value: ParamValue): void {
    this.values[key] = value;
    this.updateResetVisibility(key);
    this.onChange(key, value);
  }

  private updateResetVisibility(key: string): void {
    const w = this.widgets.get(key);
    if (!w) return;
    const differs =
      JSON.stringify(this.values[key]) !== JSON.stringify(this.defaults[key]);
    w.resetBtn.style.visibility = differs ? "visible" : "hidden";
  }

  // -------------------------------------------------------------------------

  private buildRow(spec: ParamSpec): HTMLElement {
    const row = document.createElement("div");
    row.className = "param-row";

    const head = document.createElement("div");
    head.className = "param-head";
    const label = document.createElement("span");
    label.className = "param-label";
    label.textContent = spec.label;
    if (spec.description) label.title = spec.description;
    const resetBtn = document.createElement("button");
    resetBtn.className = "param-reset";
    resetBtn.textContent = "↺";
    resetBtn.title = `Reset "${spec.label}" to default`;
    resetBtn.addEventListener("click", () => {
      const d = this.defaults[spec.key];
      const v = Array.isArray(d) ? [...d] : d;
      widget.set(v);
      this.commit(spec.key, v);
    });
    head.append(label, resetBtn);
    row.appendChild(head);

    const control = document.createElement("div");
    control.className = "param-control";
    row.appendChild(control);

    const widget = this.buildControl(spec, control);
    const full: Widget = { spec, set: widget.set, row, resetBtn };
    this.widgets.set(spec.key, full);
    widget.set(this.values[spec.key]);
    this.updateResetVisibility(spec.key);
    return row;
  }

  private buildControl(
    spec: ParamSpec,
    control: HTMLElement,
  ): { set(value: ParamValue): void } {
    switch (spec.type) {
      case "number": {
        const hasSlider = spec.min !== undefined && spec.max !== undefined;
        const num = document.createElement("input");
        num.type = "number";
        if (spec.min !== undefined) num.min = String(spec.min);
        if (spec.max !== undefined) num.max = String(spec.max);
        if (spec.step !== undefined) num.step = String(spec.step);
        if (!hasSlider) {
          num.addEventListener("change", () =>
            this.commit(spec.key, Number(num.value)));
          control.appendChild(num);
          return { set: (v) => { num.value = String(v); } };
        }
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(spec.min);
        slider.max = String(spec.max);
        slider.step = String(spec.step ?? "any");
        // Slider updates live (input), the numeric box on commit (change);
        // both stay mirrored.
        slider.addEventListener("input", () => {
          num.value = slider.value;
          this.commit(spec.key, Number(slider.value));
        });
        num.addEventListener("change", () => {
          slider.value = num.value;
          this.commit(spec.key, Number(num.value));
        });
        control.classList.add("with-slider");
        control.append(slider, num);
        return {
          set: (v) => {
            slider.value = String(v);
            num.value = String(v);
          },
        };
      }

      case "color": {
        const c = document.createElement("input");
        c.type = "color";
        c.addEventListener("input", () => this.commit(spec.key, c.value));
        control.appendChild(c);
        return { set: (v) => { c.value = String(v); } };
      }

      case "boolean": {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.addEventListener("change", () => this.commit(spec.key, cb.checked));
        control.appendChild(cb);
        return { set: (v) => { cb.checked = Boolean(v); } };
      }

      case "select": {
        const sel = document.createElement("select");
        for (const o of spec.options ?? []) {
          const opt = document.createElement("option");
          opt.value = o;
          opt.textContent = o;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => this.commit(spec.key, sel.value));
        control.appendChild(sel);
        return { set: (v) => { sel.value = String(v); } };
      }

      case "vec2":
      case "vec3":
      case "range": {
        const n = spec.type === "vec3" ? 3 : 2;
        const placeholders =
          spec.type === "range" ? ["min", "max"] : ["x", "y", "z"];
        const inputs: HTMLInputElement[] = [];
        control.classList.add("vec");
        for (let i = 0; i < n; i++) {
          const inp = document.createElement("input");
          inp.type = "number";
          inp.placeholder = placeholders[i];
          inp.title = placeholders[i];
          if (spec.min !== undefined) inp.min = String(spec.min);
          if (spec.max !== undefined) inp.max = String(spec.max);
          if (spec.step !== undefined) inp.step = String(spec.step);
          inp.addEventListener("change", () => {
            const arr = inputs.map((x) => Number(x.value) || 0);
            if (spec.type === "range" && arr[0] > arr[1]) {
              // Keep the pair ordered; reflect the swap in the UI.
              arr.sort((a, b) => a - b);
              inputs.forEach((x, j) => { x.value = String(arr[j]); });
            }
            this.commit(spec.key, arr);
          });
          inputs.push(inp);
          control.appendChild(inp);
        }
        return {
          set: (v) => {
            const arr = Array.isArray(v) ? v : [];
            inputs.forEach((x, j) => { x.value = String(arr[j] ?? 0); });
          },
        };
      }

      case "seed": {
        const num = document.createElement("input");
        num.type = "number";
        num.min = "0";
        num.step = "1";
        num.addEventListener("change", () =>
          this.commit(spec.key, Math.max(0, Math.floor(Number(num.value) || 0))));
        const dice = document.createElement("button");
        dice.className = "secondary dice";
        dice.textContent = "🎲";
        dice.title = "New random seed (result stays reproducible via the seed value)";
        dice.addEventListener("click", () => {
          // Math.random is fine HERE: it only picks the seed; everything
          // derived from the seed remains deterministic.
          const s = Math.floor(Math.random() * 100000);
          num.value = String(s);
          this.commit(spec.key, s);
        });
        control.classList.add("with-slider");
        control.append(num, dice);
        return { set: (v) => { num.value = String(v); } };
      }
    }
  }
}

"use client";

// usePrompt() — Promise-based replacement for window.prompt().
//
// Usage:
//   const { prompt, PromptDialog } = usePrompt();
//   ...
//   <PromptDialog />   {/* mount once near root of your component */}
//   ...
//   const reason = await prompt({
//     title: "Reason for rejection",
//     placeholder: "Shown to staff",
//     multiline: true,
//   });
//   if (reason === null) return;     // user cancelled
//   if (reason === "")   return;     // user submitted blank (rejected when required:true)
//
// Returns a string on submit, or null on cancel/dismiss. Pass `required: true`
// to refuse blank submissions.

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Button } from "./button";

export type PromptOptions = {
  title?: string;
  description?: React.ReactNode;
  placeholder?: string;
  /** Pre-fill the input. */
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render a textarea instead of a single-line input. */
  multiline?: boolean;
  /** Refuse to submit a blank value (after trim). */
  required?: boolean;
  /** Optional client-side validator; return a string error to block submit. */
  validate?: (value: string) => string | null | undefined;
};

type State =
  | { open: false }
  | { open: true; opts: PromptOptions; resolve: (v: string | null) => void };

type PromptDialogViewProps = {
  state: State;
  value: string;
  error: string | null;
  setValue: (v: string) => void;
  setError: (e: string | null) => void;
  close: (submitted: string | null) => void;
  submit: () => void;
};

// Module-level so its identity never changes; the hook's returned component
// must not be recreated per render, or React remounts the dialog subtree on
// every keystroke (the input loses its caret and text comes out reversed).
function PromptDialogView({ state, value, error, setValue, setError, close, submit }: PromptDialogViewProps) {
  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) close(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state.open ? state.opts.title ?? "Enter value" : ""}</DialogTitle>
          {state.open && state.opts.description ? (
            <DialogDescription>{state.opts.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="py-2">
          {state.open && state.opts.multiline ? (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              placeholder={state.opts.placeholder}
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          ) : (
            <input
              autoFocus
              type="text"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) submit();
              }}
              placeholder={state.open ? state.opts.placeholder : undefined}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(null)}>
            {state.open ? state.opts.cancelLabel ?? "Cancel" : "Cancel"}
          </Button>
          <Button onClick={submit}>
            {state.open ? state.opts.confirmLabel ?? "Submit" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function usePrompt() {
  const [state, setState] = React.useState<State>({ open: false });
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const prompt = React.useCallback((opts: PromptOptions = {}) => {
    setValue(opts.defaultValue ?? "");
    setError(null);
    return new Promise<string | null>((resolve) => {
      setState({ open: true, opts, resolve });
    });
  }, []);

  const close = React.useCallback((submitted: string | null) => {
    setState((s) => {
      if (s.open) s.resolve(submitted);
      return { open: false };
    });
  }, []);

  const submit = React.useCallback(() => {
    if (!state.open) return;
    const trimmed = value.trim();
    if (state.opts.required && trimmed.length === 0) {
      setError("Required");
      return;
    }
    if (state.opts.validate) {
      const e = state.opts.validate(trimmed);
      if (e) {
        setError(e);
        return;
      }
    }
    close(trimmed);
  }, [state, value, close]);

  // Latest-props ref: the stable PromptDialog below re-renders whenever the
  // hook's owner re-renders, and reads current values from here.
  const viewPropsRef = React.useRef<PromptDialogViewProps>({
    state, value, error, setValue, setError, close, submit,
  });
  viewPropsRef.current = { state, value, error, setValue, setError, close, submit };

  // Created exactly once per hook instance so `<PromptDialog />` keeps the
  // same element type across renders (see PromptDialogView comment).
  const [PromptDialog] = React.useState(
    () =>
      function PromptDialog() {
        return <PromptDialogView {...viewPropsRef.current} />;
      },
  );

  return { prompt, PromptDialog };
}

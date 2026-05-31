import { Text, TextInput, View } from "react-native";
import type { ComponentProps, ReactNode } from "react";

type TextInputProps = ComponentProps<typeof TextInput>;

type Props = {
  label: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
} & Omit<TextInputProps, "children">;

// Labeled form input wrapper. Pass `children` to slot in a custom
// control (picker, stepper, modal trigger); otherwise renders a
// standard styled <TextInput /> using the remaining props.
export function Field({
  label,
  hint,
  error,
  children,
  ...inputProps
}: Props) {
  return (
    <View>
      <Text className="mb-1.5 text-xs font-body-semi uppercase tracking-wide text-muted">
        {label}
      </Text>
      {children ?? (
        <TextInput
          placeholderTextColor="#9B9B9B"
          {...inputProps}
          className={
            "h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso " +
            (inputProps.className ?? "")
          }
        />
      )}
      {error ? (
        <Text className="mt-1.5 text-xs font-body text-danger">{error}</Text>
      ) : hint ? (
        <Text className="mt-1.5 text-xs font-body text-muted-fg">{hint}</Text>
      ) : null}
    </View>
  );
}

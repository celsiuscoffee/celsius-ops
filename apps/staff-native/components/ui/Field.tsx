import { Text, TextInput, View } from "react-native";
import type { ComponentProps, ReactNode } from "react";
import { useCelsius } from "../../lib/celsius-ui";

type TextInputProps = ComponentProps<typeof TextInput>;

type Props = {
  label: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
} & Omit<TextInputProps, "children">;

// Labelled input. Pass `children` to slot in a custom control (picker,
// stepper, modal trigger); otherwise renders a styled <TextInput />.
export function Field({ label, hint, error, children, ...inputProps }: Props) {
  const C = useCelsius().color;
  return (
    <View>
      <Text className="mb-1.5 text-sm font-body-semi text-text-2">{label}</Text>
      {children ?? (
        <TextInput
          placeholderTextColor={C["text-3"]}
          {...inputProps}
          className={
            `h-12 rounded-xl border bg-surface px-4 text-base font-body text-text ${error ? "border-danger" : "border-line-2"} ` +
            (inputProps.className ?? "")
          }
        />
      )}
      {error ? (
        <Text className="mt-1.5 text-sm font-body text-danger-text">{error}</Text>
      ) : hint ? (
        <Text className="mt-1.5 text-sm font-body text-text-3">{hint}</Text>
      ) : null}
    </View>
  );
}

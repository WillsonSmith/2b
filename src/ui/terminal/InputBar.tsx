import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function InputBar({ value, onChange, onSubmit, disabled = false }: InputBarProps) {
  return (
    <Box borderStyle="single" borderColor={disabled ? "gray" : "cyan"} paddingX={1}>
      <Text color={disabled ? "gray" : "white"} bold>
        {"› "}
      </Text>
      {disabled ? (
        <Text color="gray">{value.length > 0 ? value : "thinking…"}</Text>
      ) : (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (trimmed.length > 0) onSubmit(trimmed);
          }}
          placeholder="Type a message and press Enter…"
        />
      )}
    </Box>
  );
}

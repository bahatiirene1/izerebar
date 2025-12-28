/**
 * PIN Input Component
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * 4-digit PIN input with auto-focus and Apple-style animations
 */

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type ClipboardEvent,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

export interface PinInputProps {
  length?: number;
  value?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  masked?: boolean;
}

export function PinInput({
  length = 4,
  value = '',
  onChange,
  onComplete,
  error,
  disabled = false,
  autoFocus = true,
  masked = true,
}: PinInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync with external value
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Auto-focus first input
  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (index: number, char: string) => {
      if (disabled) return;

      // Only accept digits
      if (!/^\d$/.test(char)) return;

      const newValue = localValue.slice(0, index) + char + localValue.slice(index + 1);
      setLocalValue(newValue);
      onChange?.(newValue);

      // Move to next input
      if (index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Check if complete
      if (newValue.length === length) {
        onComplete?.(newValue);
      }
    },
    [localValue, length, disabled, onChange, onComplete]
  );

  const handleKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (e.key === 'Backspace') {
        e.preventDefault();

        if (localValue[index]) {
          // Clear current
          const newValue = localValue.slice(0, index) + localValue.slice(index + 1);
          setLocalValue(newValue);
          onChange?.(newValue);
        } else if (index > 0) {
          // Move to previous and clear
          const newValue = localValue.slice(0, index - 1) + localValue.slice(index);
          setLocalValue(newValue);
          onChange?.(newValue);
          inputRefs.current[index - 1]?.focus();
        }
      } else if (e.key === 'ArrowLeft' && index > 0) {
        inputRefs.current[index - 1]?.focus();
      } else if (e.key === 'ArrowRight' && index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [localValue, length, disabled, onChange]
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      if (disabled) return;

      e.preventDefault();
      const pasted = e.clipboardData.getData('text').slice(0, length);

      // Only accept digits
      if (!/^\d+$/.test(pasted)) return;

      setLocalValue(pasted);
      onChange?.(pasted);

      // Focus appropriate input
      const targetIndex = Math.min(pasted.length, length - 1);
      inputRefs.current[targetIndex]?.focus();

      if (pasted.length === length) {
        onComplete?.(pasted);
      }
    },
    [length, disabled, onChange, onComplete]
  );

  const handleFocus = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);

  const handleBlur = useCallback(() => {
    setFocusedIndex(-1);
  }, []);

  return (
    <div className="flex flex-col items-center">
      <div className="flex gap-3">
        {Array.from({ length }).map((_, index) => {
          const char = localValue[index] || '';
          const isFocused = focusedIndex === index;
          const hasValue = char !== '';

          return (
            <motion.div
              key={index}
              className="relative"
              animate={
                error
                  ? { x: [0, -4, 4, -4, 4, 0] }
                  : undefined
              }
              transition={{ duration: 0.4, ease: 'easeInOut' }}
            >
              <input
                ref={(el) => { inputRefs.current[index] = el }}
                type={masked ? 'password' : 'text'}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={1}
                value={char}
                disabled={disabled}
                onChange={(e) => handleChange(index, e.target.value.slice(-1))}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                onFocus={() => handleFocus(index)}
                onBlur={handleBlur}
                className={cn(
                  'w-14 h-16 text-center text-2xl font-semibold',
                  'rounded-xl border-2',
                  'bg-[var(--bg-secondary)]',
                  'text-[var(--text-primary)]',
                  'transition-all duration-150',
                  'focus:outline-none',
                  isFocused
                    ? 'border-[var(--color-brand-primary)]'
                    : 'border-[var(--border-default)]',
                  error && 'border-red-500',
                  disabled && 'opacity-50 cursor-not-allowed'
                )}
                aria-label={`PIN digit ${index + 1}`}
              />

              {/* Filled indicator dot (when masked) */}
              <AnimatePresence>
                {masked && hasValue && (
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  >
                    <div className="w-3 h-3 rounded-full bg-[var(--text-primary)]" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-3 text-sm text-red-500"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

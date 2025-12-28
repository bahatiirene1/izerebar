/**
 * Login Page
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Phone + PIN login with Apple-grade UX
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Phone, ArrowRight } from 'lucide-react';
import { Button, Input, Card, toast } from '@/components/ui';
import { PinInput } from '@/components/patterns/PinInput';
import { login } from '@/lib/api/auth';
import { useAuthStore } from '@/lib/store/auth';

type Step = 'phone' | 'pin';

export function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [barId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handlePhoneSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    // Basic validation
    if (!phone.match(/^\+250\d{9}$/)) {
      setError('Enter a valid Rwandan phone number (+250...)');
      return;
    }

    // For now, we'll use a placeholder barId
    // In production, this would be selected or looked up
    setStep('pin');
  };

  const handlePinComplete = async (value: string) => {
    setError('');
    setIsLoading(true);

    try {
      // TODO: Replace with actual barId lookup
      const response = await login({ phone, pin: value }, barId || 'demo-bar');

      if (response.success) {
        toast.success('Welcome back!');
        navigate('/', { replace: true });
      } else {
        setError(response.error?.message || 'Invalid credentials');
        setPin('');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-primary)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--color-brand-primary)] mb-4">
            <span className="text-2xl font-bold text-white">I</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Welcome to Izerebar
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Sign in to manage your bar
          </p>
        </div>

        <Card padding="lg">
          {step === 'phone' ? (
            <motion.form
              key="phone"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              onSubmit={handlePhoneSubmit}
              className="space-y-4"
            >
              <Input
                label="Phone Number"
                type="tel"
                placeholder="+250 7XX XXX XXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                leftIcon={<Phone size={18} />}
                error={error}
                autoFocus
              />

              <Button
                type="submit"
                className="w-full"
                rightIcon={<ArrowRight size={18} />}
              >
                Continue
              </Button>
            </motion.form>
          ) : (
            <motion.div
              key="pin"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center">
                <p className="text-sm text-[var(--text-secondary)]">
                  Enter your 4-digit PIN
                </p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {phone}
                </p>
              </div>

              <PinInput
                value={pin}
                onChange={setPin}
                onComplete={handlePinComplete}
                error={error}
                disabled={isLoading}
              />

              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setPin('');
                  setError('');
                }}
                className="w-full text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Use a different number
              </button>
            </motion.div>
          )}
        </Card>

        {/* Register link */}
        <p className="text-center mt-6 text-sm text-[var(--text-secondary)]">
          Don't have an account?{' '}
          <Link
            to="/register"
            className="text-[var(--color-brand-primary)] hover:underline font-medium"
          >
            Register your bar
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

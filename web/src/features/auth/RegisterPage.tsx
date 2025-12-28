/**
 * Register Page
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Business registration with multi-step form
 */

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  Phone,
  CreditCard,
  Building2,
  MapPin,
  ArrowRight,
  ArrowLeft,
  Check,
} from 'lucide-react';
import { Button, Input, Card, toast } from '@/components/ui';
import { PinInput } from '@/components/patterns/PinInput';
import { register } from '@/lib/api/auth';
import { cn } from '@/lib/utils';

type Step = 1 | 2 | 3;

interface FormData {
  ownerName: string;
  ownerPhone: string;
  ownerNationalId: string;
  ownerPin: string;
  barName: string;
  barTin: string;
  barLocation: string;
}

const initialFormData: FormData = {
  ownerName: '',
  ownerPhone: '',
  ownerNationalId: '',
  ownerPin: '',
  barName: '',
  barTin: '',
  barLocation: '',
};

export function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [isLoading, setIsLoading] = useState(false);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validateStep1 = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.ownerName.trim()) {
      newErrors.ownerName = 'Name is required';
    }

    if (!formData.ownerPhone.match(/^\+250\d{9}$/)) {
      newErrors.ownerPhone = 'Enter a valid Rwandan phone number';
    }

    if (!formData.ownerNationalId.match(/^1\d{15}$/)) {
      newErrors.ownerNationalId = 'Enter a valid 16-digit National ID';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.barName.trim()) {
      newErrors.barName = 'Bar name is required';
    }

    if (!formData.barTin.match(/^\d{9}$/)) {
      newErrors.barTin = 'Enter a valid 9-digit TIN';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) {
      setStep(2);
    } else if (step === 2 && validateStep2()) {
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((step - 1) as Step);
    }
  };

  const handlePinComplete = async (pin: string) => {
    setFormData((prev) => ({ ...prev, ownerPin: pin }));
    setIsLoading(true);

    try {
      const response = await register({
        ownerName: formData.ownerName,
        ownerPhone: formData.ownerPhone,
        ownerNationalId: formData.ownerNationalId,
        ownerPin: pin,
        barName: formData.barName,
        barTin: formData.barTin,
        barLocation: formData.barLocation || undefined,
      });

      if (response.success) {
        toast.success('Registration successful!', 'You can now login to your bar.');
        navigate('/login');
      } else {
        toast.error('Registration failed', response.error?.message);
        setFormData((prev) => ({ ...prev, ownerPin: '' }));
      }
    } catch (err) {
      toast.error('Connection error', 'Please try again.');
      setFormData((prev) => ({ ...prev, ownerPin: '' }));
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
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--color-brand-primary)] mb-4">
            <span className="text-2xl font-bold text-white">I</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Register Your Bar
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Create your business account
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium',
                'transition-colors duration-200',
                step >= s
                  ? 'bg-[var(--color-brand-primary)] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
              )}
            >
              {step > s ? <Check size={16} /> : s}
            </div>
          ))}
        </div>

        <Card padding="lg">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4"
              >
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  Owner Information
                </h2>

                <Input
                  label="Full Name"
                  placeholder="Enter your full name"
                  value={formData.ownerName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('ownerName', e.target.value)}
                  leftIcon={<User size={18} />}
                  error={errors.ownerName}
                  autoFocus
                />

                <Input
                  label="Phone Number"
                  type="tel"
                  placeholder="+250 7XX XXX XXX"
                  value={formData.ownerPhone}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('ownerPhone', e.target.value)}
                  leftIcon={<Phone size={18} />}
                  error={errors.ownerPhone}
                />

                <Input
                  label="National ID"
                  placeholder="1XXXXXXXXXXXXXXX"
                  value={formData.ownerNationalId}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('ownerNationalId', e.target.value)}
                  leftIcon={<CreditCard size={18} />}
                  error={errors.ownerNationalId}
                  maxLength={16}
                />

                <Button
                  type="button"
                  onClick={handleNext}
                  className="w-full"
                  rightIcon={<ArrowRight size={18} />}
                >
                  Continue
                </Button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  Bar Information
                </h2>

                <Input
                  label="Bar Name"
                  placeholder="Enter your bar's name"
                  value={formData.barName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('barName', e.target.value)}
                  leftIcon={<Building2 size={18} />}
                  error={errors.barName}
                  autoFocus
                />

                <Input
                  label="TIN Number"
                  placeholder="9-digit TIN"
                  value={formData.barTin}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('barTin', e.target.value)}
                  leftIcon={<CreditCard size={18} />}
                  error={errors.barTin}
                  maxLength={9}
                />

                <Input
                  label="Location (Optional)"
                  placeholder="Kigali, Rwanda"
                  value={formData.barLocation}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('barLocation', e.target.value)}
                  leftIcon={<MapPin size={18} />}
                />

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleBack}
                    leftIcon={<ArrowLeft size={18} />}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="flex-1"
                    rightIcon={<ArrowRight size={18} />}
                  >
                    Continue
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    Create Your PIN
                  </h2>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    You'll use this PIN to login and confirm sales
                  </p>
                </div>

                <PinInput
                  value={formData.ownerPin}
                  onChange={(value: string) => updateField('ownerPin', value)}
                  onComplete={handlePinComplete}
                  disabled={isLoading}
                />

                <button
                  type="button"
                  onClick={handleBack}
                  disabled={isLoading}
                  className="w-full text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                >
                  Go back
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Login link */}
        <p className="text-center mt-6 text-sm text-[var(--text-secondary)]">
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-[var(--color-brand-primary)] hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

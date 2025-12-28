/**
 * Dashboard Page
 * @implements ARCHITECTURE.md Section 8 - UI Layer
 *
 * Role-specific dashboard with key metrics
 */

import { motion } from 'motion/react';
import {
  ShoppingCart,
  TrendingUp,
  Users,
  Package,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { AppShell } from '@/components/layout';
import { useUserRole, useUser, useBar } from '@/lib/store/auth';
import { formatCurrency } from '@/lib/utils';
import { staggerContainer, staggerChild } from '@/design-system/tokens';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
}

function StatCard({ title, value, change, icon }: StatCardProps) {
  const isPositive = change && change > 0;
  const isNegative = change && change < 0;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--text-secondary)]">{title}</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">
            {value}
          </p>
          {change !== undefined && (
            <div
              className={`flex items-center gap-1 mt-2 text-sm ${
                isPositive
                  ? 'text-green-500'
                  : isNegative
                  ? 'text-red-500'
                  : 'text-[var(--text-tertiary)]'
              }`}
            >
              {isPositive ? (
                <ArrowUpRight size={16} />
              ) : isNegative ? (
                <ArrowDownRight size={16} />
              ) : null}
              <span>{Math.abs(change)}% from yesterday</span>
            </div>
          )}
        </div>
        <div className="p-3 rounded-xl bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]">
          {icon}
        </div>
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const user = useUser();
  const bar = useBar();
  const role = useUserRole();

  // Mock data - will be replaced with actual API calls
  const stats = {
    todaySales: 245000,
    pendingSales: 12,
    confirmedSales: 45,
    activeStaff: 4,
  };

  return (
    <AppShell>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Welcome section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Good {getTimeOfDay()}, {user?.name?.split(' ')[0] || 'there'}!
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Here's what's happening at {bar?.name || 'your bar'} today.
          </p>
        </motion.div>

        {/* Stats grid */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
        >
          <motion.div variants={staggerChild}>
            <StatCard
              title="Today's Sales"
              value={formatCurrency(stats.todaySales)}
              change={12}
              icon={<TrendingUp size={24} />}
            />
          </motion.div>

          <motion.div variants={staggerChild}>
            <StatCard
              title="Pending Sales"
              value={stats.pendingSales}
              icon={<ShoppingCart size={24} />}
            />
          </motion.div>

          <motion.div variants={staggerChild}>
            <StatCard
              title="Confirmed Sales"
              value={stats.confirmedSales}
              change={5}
              icon={<Package size={24} />}
            />
          </motion.div>

          {(role === 'owner' || role === 'manager') && (
            <motion.div variants={staggerChild}>
              <StatCard
                title="Active Staff"
                value={stats.activeStaff}
                icon={<Users size={24} />}
              />
            </motion.div>
          )}
        </motion.div>

        {/* Quick actions or recent activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-[var(--text-tertiary)]">
                <p>No recent activity</p>
                <p className="text-sm mt-1">
                  Sales and stock movements will appear here
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </AppShell>
  );
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

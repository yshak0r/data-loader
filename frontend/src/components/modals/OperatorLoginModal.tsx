import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import {
  Lock,
  UserCheck,
  ShieldCheck,
  AlertCircle,
  KeyRound,
  CheckCircle2,
} from 'lucide-react';
import { LicenseStatus } from '../../types/security';
import { dbClient } from '../../lib/dbClient';
import { CloseWindow } from '@/../wailsjs/go/main/App';

interface OperatorLoginModalProps {
  open: boolean;
  status: LicenseStatus;
  onLoginSuccess: (status: LicenseStatus) => void;
}

export const OperatorLoginModal: React.FC<OperatorLoginModalProps> = ({
  open,
  status,
  onLoginSuccess,
}) => {
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setErrorMsg('Please enter your operator passcode.');
      return;
    }

    setErrorMsg(null);
    setIsAuthenticating(true);
    try {
      const res = await dbClient.authenticateOperator(password);
      if (res.success && res.status.isAuthenticated) {
        setPassword('');
        onLoginSuccess(res.status);
      } else {
        setErrorMsg(res.message || 'Incorrect passcode.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Authentication error.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md bg-zinc-950 border-zinc-800 text-zinc-100 shadow-2xl p-6"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-zinc-100">
                Authorized Operator Authentication
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                Single-user credential lock enabled for this machine.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Machine & Operator Info Banner */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 font-medium">Machine Code</span>
            <span className="font-mono text-zinc-300 font-semibold">{status.machineId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 font-medium">Licensed Client</span>
            <span className="text-zinc-200 font-semibold">{status.clientName || 'Ross ERP Client'}</span>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-800 pt-2">
            <span className="text-indigo-400 font-semibold flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5" /> Authorized User
            </span>
            <span className="font-mono text-indigo-300 font-bold">
              {status.authorizedUser || 'Designated Operator'}
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs p-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-indigo-400" /> Enter Operator Passcode:
            </label>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your confidential password/PIN"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3.5 py-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-zinc-500">
              Only the authorized operator with this passcode can access data and load orders.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => CloseWindow()}
              className="text-xs h-8 text-zinc-400 border-zinc-800 hover:bg-zinc-900"
            >
              Exit Application
            </Button>
            <Button
              type="submit"
              disabled={isAuthenticating || !password.trim()}
              size="sm"
              className="text-xs h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md shadow-indigo-950"
            >
              {isAuthenticating ? 'Verifying...' : 'Unlock Application'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

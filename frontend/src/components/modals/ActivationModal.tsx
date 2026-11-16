import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  ShieldAlert,
  ShieldCheck,
  Copy,
  Check,
  FileUp,
  KeyRound,
  Laptop,
  RefreshCw,
  X,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { LicenseStatus } from '../../types/security';
import { dbClient } from '../../lib/dbClient';
import { cn } from '@/lib/utils';
import { CloseWindow } from '@/../wailsjs/go/main/App';

interface ActivationModalProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  status: LicenseStatus;
  onActivationSuccess: (newStatus: LicenseStatus) => void;
  canDismiss?: boolean;
}

export const ActivationModal: React.FC<ActivationModalProps> = ({
  open,
  onOpenChange,
  status,
  onActivationSuccess,
  canDismiss = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [licenseText, setLicenseText] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentMachineId, setCurrentMachineId] = useState<string>(status.machineId || '');

  // Keep machine ID in sync with incoming status
  useEffect(() => {
    if (status.machineId && status.machineId !== 'ROSS-UNKNOWN') {
      setCurrentMachineId(status.machineId);
    } else {
      // If status didn't have it, attempt a direct fetch
      handleRegenerateMachineId();
    }
  }, [status.machineId]);

  const handleCopyMachineId = () => {
    const code = currentMachineId || status.machineId;
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleRegenerateMachineId = async () => {
    setIsRegenerating(true);
    setErrorMsg(null);
    try {
      const code = await dbClient.getMachineFingerprint();
      if (code && code !== 'ROSS-UNKNOWN') {
        setCurrentMachineId(code);
      } else {
        const freshStatus = await dbClient.getLicenseStatus();
        if (freshStatus.machineId) {
          setCurrentMachineId(freshStatus.machineId);
        }
      }
    } catch (err: any) {
      console.error('Failed to regenerate machine code:', err);
    } finally {
      setTimeout(() => setIsRegenerating(false), 400);
    }
  };

  const handleSelectLicenseFile = async () => {
    try {
      setErrorMsg(null);
      const res = await dbClient.openLicenseFileDialog();
      if (!res.canceled && res.fileContent) {
        setIsActivating(true);
        const result = await dbClient.activateLicenseFile(res.fileContent);
        setIsActivating(false);
        if (result.success) {
          onActivationSuccess(result.status);
        } else {
          setErrorMsg(result.message);
        }
      }
    } catch (err: any) {
      setIsActivating(false);
      setErrorMsg(err.message || 'Failed to read license file.');
    }
  };

  const handleManualActivate = async () => {
    if (!licenseText.trim()) {
      setErrorMsg('Please paste the license JSON or payload content.');
      return;
    }
    try {
      setErrorMsg(null);
      setIsActivating(true);
      const result = await dbClient.activateLicenseFile(licenseText.trim());
      setIsActivating(false);
      if (result.success) {
        onActivationSuccess(result.status);
      } else {
        setErrorMsg(result.message);
      }
    } catch (err: any) {
      setIsActivating(false);
      setErrorMsg(err.message || 'Invalid license format.');
    }
  };

  const handleRevokeLicense = async () => {
    if (!confirm('Are you sure you want to revoke the current license on this machine? You will need to import or activate a new license key.')) {
      return;
    }
    try {
      setErrorMsg(null);
      setIsRevoking(true);
      const res = await dbClient.revokeLicense();
      setIsRevoking(false);
      if (res.success) {
        onActivationSuccess(res.status);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err: any) {
      setIsRevoking(false);
      setErrorMsg(err.message || 'Failed to revoke license.');
    }
  };

  // Close handler: if activated and dismissible, close modal; if unactivated, close application
  const handleExitApp = () => {
    if (canDismiss && onOpenChange) {
      onOpenChange(false);
    } else {
      CloseWindow();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) {
          handleExitApp();
        }
      }}
    >
      <DialogContent
        className="max-w-xl bg-card border-border text-foreground p-6 shadow-2xl"
        onCloseClick={handleExitApp}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleExitApp();
        }}
        onPointerDownOutside={(e) => {
          if (!canDismiss) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-colors',
                status.isActivated
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
              )}
            >
              {status.isActivated ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2 flex-wrap">
                Enterprise Device Authorization
                {status.isActivated ? (
                  <Badge
                    variant="outline"
                    className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-[10px]"
                  >
                    Activated
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10 text-[10px]"
                  >
                    Activation Required
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                This Ross ERP Data Capture Loader instance is bound exclusively to permitted hardware devices.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Machine Identification Section */}
          <div className="p-3.5 rounded-lg bg-secondary/40 border border-border space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Laptop className="h-3.5 w-3.5 text-primary" />
                This Machine Identification Code
              </span>
              <span className="text-[10px] text-muted-foreground font-mono bg-secondary/80 px-2 py-0.5 rounded border border-border">
                Hardware Linked
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-background border border-border rounded-md px-3 py-2 font-mono text-sm tracking-wider font-semibold text-primary select-all shadow-inner overflow-x-auto min-h-[38px] flex items-center">
                {currentMachineId || 'Retrieving hardware fingerprint...'}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerateMachineId}
                disabled={isRegenerating}
                className="h-9 px-3 border-border hover:bg-secondary text-foreground text-xs shrink-0"
                title="Re-query hardware components and refresh machine code"
              >
                <RefreshCw
                  className={cn(
                    'h-3.5 w-3.5',
                    isRegenerating && 'animate-spin text-primary'
                  )}
                />
                <span className="ml-1.5 hidden sm:inline">Regenerate</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyMachineId}
                className="h-9 px-3 border-border hover:bg-secondary text-foreground text-xs shrink-0"
                title="Copy Machine Code to clipboard"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Send this Machine Code to your system administrator to generate a signed activation license file (<code className="font-mono text-foreground font-medium">*.lic</code>) for this computer.
            </p>
          </div>

          {/* Active License Details (if already licensed) */}
          {status.isActivated && (
            <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-2 font-mono">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans text-[11px]">Licensed Entity:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-sans">
                  {status.clientName || 'Authorized Client'}
                </span>
              </div>
              {status.authorizedUser && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-sans text-[11px]">Authorized Operator:</span>
                  <span className="font-semibold text-indigo-500 dark:text-indigo-400 font-sans">
                    {status.authorizedUser}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans text-[11px]">Expiration Date:</span>
                <span className="text-foreground">
                  {status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : 'Perpetual'}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-emerald-500/20">
                <span className="text-muted-foreground font-sans text-[11px]">License Validity:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-sans">
                  {status.daysRemaining} day(s) remaining
                </span>
              </div>
              <div className="pt-2 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRevokeLicense}
                  disabled={isRevoking}
                  className="h-7 px-2.5 text-xs border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/50 flex items-center gap-1 font-sans"
                  title="Revoke and remove current license from this machine"
                >
                  <Trash2 className="w-3 h-3" />
                  {isRevoking ? 'Revoking...' : 'Revoke Current License'}
                </Button>
              </div>
            </div>
          )}

          {/* Error Message Alert Box */}
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
          )}

          {/* Import / Activation Controls */}
          <div className="space-y-3">
            <Button
              onClick={handleSelectLicenseFile}
              disabled={isActivating}
              className="w-full h-10 text-xs font-semibold shadow-sm"
            >
              <FileUp className="w-4 h-4 mr-2" />
              Import License File (*.lic)
            </Button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-border"></div>
              <span className="flex-shrink mx-3 text-[10px] uppercase font-semibold text-muted-foreground">
                or paste license payload
              </span>
              <div className="flex-grow border-t border-border"></div>
            </div>

            <div className="space-y-2">
              <textarea
                placeholder="Paste JSON license content here..."
                value={licenseText}
                onChange={(e) => setLicenseText(e.target.value)}
                rows={3}
                className="w-full bg-background border border-border rounded-md p-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none shadow-inner"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleManualActivate}
                disabled={isActivating || !licenseText.trim()}
                className="w-full h-8 text-xs font-medium border border-border"
              >
                <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                Activate with Pasted Key
              </Button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-border flex items-center justify-between mt-2">
          <span className="text-[11px] text-muted-foreground">Ross ERP DC Loader v1.0.0</span>
          {canDismiss ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange?.(false)}
              className="text-xs"
            >
              Close
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExitApp}
              className="text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors"
              title="Close the entire application"
            >
              <X className="w-3.5 h-3.5 mr-1.5 text-destructive" />
              Exit Application
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

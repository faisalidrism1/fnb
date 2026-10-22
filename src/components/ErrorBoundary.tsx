import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getSavedLanguage } from '../utils/i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  public handleReload = () => {
    window.location.reload();
  };

  public handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const lang = getSavedLanguage();
      const isId = lang === 'id';

      return (
        <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-[#37003c] text-white p-6 sm:p-8 rounded-2xl shadow-xl max-w-md w-full border-2 border-purple-800 space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white">
              {isId ? 'Terjadi Kendala Memuat Komponen' : 'Component Loading Error'}
            </h2>
            <p className="text-xs text-slate-300">
              {this.state.error?.message ||
                (isId
                  ? 'Silakan muat ulang halaman untuk memulihkan tampilan aplikasi.'
                  : 'Please reload the page to restore application display.')}
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-purple-800 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
              >
                {isId ? 'Coba Lagi' : 'Try Again'}
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-[#00ff87] hover:bg-[#00e575] text-[#37003c] rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {isId ? 'Muat Ulang' : 'Reload Page'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

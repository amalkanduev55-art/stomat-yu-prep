import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; scope?: 'app' | 'viewer'; onRetry?: () => void };
export default class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('YU-Prep:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const viewer = this.props.scope === 'viewer';
    return <div className={`recovery-screen ${viewer ? 'viewer-recovery' : ''}`} role="alert">
      <div className="recovery-card">
        <span className="recovery-brand">YU-Prep</span>
        <h2>{viewer ? 'Не удалось запустить 3D Viewer' : 'Не удалось загрузить приложение'}</h2>
        <p>{viewer ? 'Браузер не смог создать или сохранить графический контекст. Проверьте аппаратное ускорение и поддержку WebGL 2. Панели проекта остаются доступны.' : 'Попробуйте загрузить приложение повторно. Если ошибка повторяется, сохраните её текст и проверьте эту ссылку в актуальном Chrome или Edge.'}</p>
        <button className="primary full" onClick={() => {
          if (this.props.onRetry) { this.props.onRetry(); this.setState({ error: null }); }
          else window.location.reload();
        }}>{viewer ? 'Повторить в облегчённом режиме' : 'Перезагрузить приложение'}</button>
        <details><summary>Техническая информация</summary><pre>{this.state.error.message}</pre></details>
      </div>
    </div>;
  }
}

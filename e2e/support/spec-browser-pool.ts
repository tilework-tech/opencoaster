export class SpecBrowserPool<T extends { close(): Promise<void> }> {
  private current: { file: string; browser: T } | undefined;

  async acquire(file: string, launch: () => Promise<T>): Promise<T> {
    const current = this.current;
    if (current && current.file === file) return current.browser;
    await this.close();
    this.current = { file, browser: await launch() };
    return this.current.browser;
  }

  async close(): Promise<void> {
    const browser = this.current?.browser;
    this.current = undefined;
    await browser?.close();
  }
}

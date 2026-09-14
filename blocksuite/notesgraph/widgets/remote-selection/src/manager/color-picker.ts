class RandomPicker<T> {
  private _copyArray: T[];

  private readonly _originalArray: T[];

  constructor(array: T[]) {
    this._originalArray = [...array];
    this._copyArray = [...array];
  }

  private randomIndex(max: number): number {
    return Math.floor(Math.random() * max);
  }

  pick(): T {
    if (this._copyArray.length === 0) {
      this._copyArray = [...this._originalArray];
    }

    const index = this.randomIndex(this._copyArray.length);
    const item = this._copyArray[index];
    this._copyArray.splice(index, 1);
    return item;
  }
}

export const multiPlayersColor = new RandomPicker([
  'var(--notesgraph-multi-players-purple)',
  'var(--notesgraph-multi-players-magenta)',
  'var(--notesgraph-multi-players-red)',
  'var(--notesgraph-multi-players-orange)',
  'var(--notesgraph-multi-players-green)',
  'var(--notesgraph-multi-players-blue)',
  'var(--notesgraph-multi-players-brown)',
  'var(--notesgraph-multi-players-grey)',
]);

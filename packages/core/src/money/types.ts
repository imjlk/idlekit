export type Unit<U extends string> = Readonly<{
  code: U;
  symbol?: string;
}>;

export type Money<N, U extends string> = Readonly<{
  unit: Unit<U>;
  amount: N;
}>;

export type MoneyState<N, U extends string> = Readonly<{
  money: Money<N, U>;
  bucket: N;
}>;

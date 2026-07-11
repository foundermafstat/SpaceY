import type { WalletCurrencyDto, WalletDto } from "@spacey/contracts";

type WalletStripProps = {
  wallet: WalletDto;
};

const walletEntries: Array<{ currency: WalletCurrencyDto; label: string }> = [
  { currency: "credits", label: "Credits" },
  { currency: "scrap", label: "Scrap" },
  { currency: "alloy", label: "Alloy" },
  { currency: "dataShards", label: "Data" }
];

const amountFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export function WalletStrip({ wallet }: WalletStripProps) {
  return (
    <dl className="wallet-strip" aria-label="Wallet">
      {walletEntries.map(({ currency, label }) => (
        <div className="wallet-strip-item" key={currency}>
          <dt>{label}</dt>
          <dd>{amountFormatter.format(wallet[currency])}</dd>
        </div>
      ))}
    </dl>
  );
}

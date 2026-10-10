/*
 * The data model. Every amount is an integer number of minor units
 * (paisa / halala / cents), never a float, so sums are always exact.
 * Exchange rates are integers scaled by 10,000 (11.2550 -> 112550).
 */

export type PartyKind = 'customer' | 'agent' | 'partner';

export interface Party {
  id: string;
  kind: PartyKind;
  name: string;
  phone?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/*
 * send     – a customer sends money home through an agent.
 *            Customer owes amount + fee − paid; cash gets `paid`;
 *            the agent is owed `homeAmount` (in the home currency).
 * receive  – cash comes in from a party (customer pays a due, partner gives money,
 *            agent sends money back).
 * give     – cash goes out to a party (paying the agent, giving a partner money, a loan).
 * expense  – a business cost paid from cash.
 * cash_in  – own money added to the cash box.
 * cash_out – own money taken out of the cash box.
 * opening  – a starting balance (signed). With a party it is that party's
 *            old balance; without one it is the opening cash.
 */
export type TxnType = 'send' | 'receive' | 'give' | 'expense' | 'cash_in' | 'cash_out' | 'opening';

export interface Txn {
  id: string;
  type: TxnType;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  partyId?: string;
  /** Only for `send`: the agent at home who pays the receiver. */
  agentId?: string;
  /** Main amount in the local currency (minor units). Signed only for `opening`. */
  amount: number;
  /** Amount in the home currency (minor units). Present for `send` and for give/receive with an agent. */
  homeAmount?: number;
  /** Rate used, home per one local unit, ×10,000. */
  rateE4?: number;
  /** Service charge taken from the customer (local, minor units). */
  fee?: number;
  /** Cash the customer paid at once for a `send` (local, minor units). */
  paid?: number;
  /** Who gets the money at home (name / number). */
  receiver?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface Settings {
  businessName: string;
  localCurrency: string;
  homeCurrency: string;
  defaultRateE4: number;
  updatedAt: number;
}

export interface Db {
  version: 1;
  parties: Record<string, Party>;
  txns: Record<string, Txn>;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  businessName: '',
  localCurrency: 'SAR',
  homeCurrency: 'BDT',
  defaultRateE4: 320000,
  updatedAt: 0,
};

export function emptyDb(): Db {
  return { version: 1, parties: {}, txns: {}, settings: { ...DEFAULT_SETTINGS } };
}

export function newId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

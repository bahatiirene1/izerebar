/**
 * Domain Layer Exports
 * @implements ARCHITECTURE.md - Domain/Service Layer
 */

// Services
export { AuthService } from './auth.service';
export type {
  LoginInput,
  LoginResult,
  RegisterDeviceInput,
  RequestOtpInput,
  ResetPinInput,
  RegisterBusinessInput,
  RegisterBusinessResult,
} from './auth.service';

export { ShiftService } from './shift.service';
export type {
  OpenDayInput,
  CloseDayInput,
  ReconcileDayInput,
  CreateShiftInput,
  OpenShiftInput,
  CloseShiftInput,
  ReconcileShiftInput,
  AssignToShiftInput,
  DayWithShifts,
} from './shift.service';

export { StockService } from './stock.service';
export type {
  ReceiveDeliveryInput,
  AllocateStockInput,
  AssignStockInput,
  ReturnStockInput,
  AdjustStockInput,
  StockBalance,
  UserStockBalance,
} from './stock.service';

export { SalesService } from './sales.service';
export type {
  CreateSaleInput,
  CreateSaleResult,
  CollectSaleInput,
  ConfirmSaleInput,
  ReverseSaleInput,
  SaleWithDetails,
  ServerObligationSummary,
} from './sales.service';

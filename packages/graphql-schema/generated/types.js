"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRole = exports.Trend = exports.TransactionType = exports.ReportType = exports.PeriodType = exports.PaymentMethod = exports.NotificationStatus = exports.LoanStatus = exports.IssueType = exports.EmployeeType = exports.DocumentType = exports.DistributionMode = exports.DeadDebtStatus = exports.ClientCategory = exports.CvStatus = exports.AccountType = void 0;
var AccountType;
(function (AccountType) {
    AccountType["Bank"] = "BANK";
    AccountType["EmployeeCashFund"] = "EMPLOYEE_CASH_FUND";
    AccountType["OfficeCashFund"] = "OFFICE_CASH_FUND";
    AccountType["PrepaidGas"] = "PREPAID_GAS";
    AccountType["TravelExpenses"] = "TRAVEL_EXPENSES";
})(AccountType || (exports.AccountType = AccountType = {}));
var CvStatus;
(function (CvStatus) {
    CvStatus["AlCorriente"] = "AL_CORRIENTE";
    CvStatus["EnCv"] = "EN_CV";
    CvStatus["Excluido"] = "EXCLUIDO";
})(CvStatus || (exports.CvStatus = CvStatus = {}));
var ClientCategory;
(function (ClientCategory) {
    ClientCategory["Activo"] = "ACTIVO";
    ClientCategory["EnCv"] = "EN_CV";
    ClientCategory["Finalizado"] = "FINALIZADO";
    ClientCategory["Nuevo"] = "NUEVO";
    ClientCategory["Reintegro"] = "REINTEGRO";
    ClientCategory["Renovado"] = "RENOVADO";
})(ClientCategory || (exports.ClientCategory = ClientCategory = {}));
var DeadDebtStatus;
(function (DeadDebtStatus) {
    DeadDebtStatus["All"] = "ALL";
    DeadDebtStatus["Marked"] = "MARKED";
    DeadDebtStatus["Unmarked"] = "UNMARKED";
})(DeadDebtStatus || (exports.DeadDebtStatus = DeadDebtStatus = {}));
var DistributionMode;
(function (DistributionMode) {
    DistributionMode["FixedEqual"] = "FIXED_EQUAL";
    DistributionMode["Variable"] = "VARIABLE";
})(DistributionMode || (exports.DistributionMode = DistributionMode = {}));
var DocumentType;
(function (DocumentType) {
    DocumentType["Domicilio"] = "DOMICILIO";
    DocumentType["Ine"] = "INE";
    DocumentType["Otro"] = "OTRO";
    DocumentType["Pagare"] = "PAGARE";
})(DocumentType || (exports.DocumentType = DocumentType = {}));
var EmployeeType;
(function (EmployeeType) {
    EmployeeType["Lead"] = "LEAD";
    EmployeeType["RouteAssistent"] = "ROUTE_ASSISTENT";
    EmployeeType["RouteLead"] = "ROUTE_LEAD";
})(EmployeeType || (exports.EmployeeType = EmployeeType = {}));
var IssueType;
(function (IssueType) {
    IssueType["Error"] = "ERROR";
    IssueType["Missing"] = "MISSING";
})(IssueType || (exports.IssueType = IssueType = {}));
var LoanStatus;
(function (LoanStatus) {
    LoanStatus["Active"] = "ACTIVE";
    LoanStatus["Cancelled"] = "CANCELLED";
    LoanStatus["Finished"] = "FINISHED";
    LoanStatus["Renovated"] = "RENOVATED";
})(LoanStatus || (exports.LoanStatus = LoanStatus = {}));
var NotificationStatus;
(function (NotificationStatus) {
    NotificationStatus["Failed"] = "FAILED";
    NotificationStatus["Pending"] = "PENDING";
    NotificationStatus["Retry"] = "RETRY";
    NotificationStatus["Sent"] = "SENT";
})(NotificationStatus || (exports.NotificationStatus = NotificationStatus = {}));
var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["Cash"] = "CASH";
    PaymentMethod["MoneyTransfer"] = "MONEY_TRANSFER";
})(PaymentMethod || (exports.PaymentMethod = PaymentMethod = {}));
var PeriodType;
(function (PeriodType) {
    PeriodType["Monthly"] = "MONTHLY";
    PeriodType["Weekly"] = "WEEKLY";
})(PeriodType || (exports.PeriodType = PeriodType = {}));
var ReportType;
(function (ReportType) {
    ReportType["CreditosConErrores"] = "CREDITOS_CON_ERRORES";
    ReportType["NotificacionTiempoReal"] = "NOTIFICACION_TIEMPO_REAL";
})(ReportType || (exports.ReportType = ReportType = {}));
var TransactionType;
(function (TransactionType) {
    TransactionType["Expense"] = "EXPENSE";
    TransactionType["Income"] = "INCOME";
    TransactionType["Investment"] = "INVESTMENT";
    TransactionType["Transfer"] = "TRANSFER";
})(TransactionType || (exports.TransactionType = TransactionType = {}));
var Trend;
(function (Trend) {
    Trend["Down"] = "DOWN";
    Trend["Stable"] = "STABLE";
    Trend["Up"] = "UP";
})(Trend || (exports.Trend = Trend = {}));
var UserRole;
(function (UserRole) {
    UserRole["Admin"] = "ADMIN";
    UserRole["Captura"] = "CAPTURA";
    UserRole["DocumentReviewer"] = "DOCUMENT_REVIEWER";
    UserRole["Normal"] = "NORMAL";
})(UserRole || (exports.UserRole = UserRole = {}));
//# sourceMappingURL=types.js.map
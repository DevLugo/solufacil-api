export var AccountType;
(function (AccountType) {
    AccountType["Bank"] = "BANK";
    AccountType["EmployeeCashFund"] = "EMPLOYEE_CASH_FUND";
    AccountType["OfficeCashFund"] = "OFFICE_CASH_FUND";
    AccountType["PrepaidGas"] = "PREPAID_GAS";
    AccountType["TravelExpenses"] = "TRAVEL_EXPENSES";
})(AccountType || (AccountType = {}));
export var CvStatus;
(function (CvStatus) {
    CvStatus["AlCorriente"] = "AL_CORRIENTE";
    CvStatus["EnCv"] = "EN_CV";
    CvStatus["Excluido"] = "EXCLUIDO";
})(CvStatus || (CvStatus = {}));
export var ClientCategory;
(function (ClientCategory) {
    ClientCategory["Activo"] = "ACTIVO";
    ClientCategory["EnCv"] = "EN_CV";
    ClientCategory["Finalizado"] = "FINALIZADO";
    ClientCategory["Nuevo"] = "NUEVO";
    ClientCategory["Reintegro"] = "REINTEGRO";
    ClientCategory["Renovado"] = "RENOVADO";
})(ClientCategory || (ClientCategory = {}));
export var DeadDebtStatus;
(function (DeadDebtStatus) {
    DeadDebtStatus["All"] = "ALL";
    DeadDebtStatus["Marked"] = "MARKED";
    DeadDebtStatus["Unmarked"] = "UNMARKED";
})(DeadDebtStatus || (DeadDebtStatus = {}));
export var DistributionMode;
(function (DistributionMode) {
    DistributionMode["FixedEqual"] = "FIXED_EQUAL";
    DistributionMode["Variable"] = "VARIABLE";
})(DistributionMode || (DistributionMode = {}));
export var DocumentType;
(function (DocumentType) {
    DocumentType["Domicilio"] = "DOMICILIO";
    DocumentType["Ine"] = "INE";
    DocumentType["Otro"] = "OTRO";
    DocumentType["Pagare"] = "PAGARE";
})(DocumentType || (DocumentType = {}));
export var EmployeeType;
(function (EmployeeType) {
    EmployeeType["Lead"] = "LEAD";
    EmployeeType["RouteAssistent"] = "ROUTE_ASSISTENT";
    EmployeeType["RouteLead"] = "ROUTE_LEAD";
})(EmployeeType || (EmployeeType = {}));
export var IssueType;
(function (IssueType) {
    IssueType["Error"] = "ERROR";
    IssueType["Missing"] = "MISSING";
})(IssueType || (IssueType = {}));
export var LoanStatus;
(function (LoanStatus) {
    LoanStatus["Active"] = "ACTIVE";
    LoanStatus["Cancelled"] = "CANCELLED";
    LoanStatus["Finished"] = "FINISHED";
    LoanStatus["Renovated"] = "RENOVATED";
})(LoanStatus || (LoanStatus = {}));
export var NotificationStatus;
(function (NotificationStatus) {
    NotificationStatus["Failed"] = "FAILED";
    NotificationStatus["Pending"] = "PENDING";
    NotificationStatus["Retry"] = "RETRY";
    NotificationStatus["Sent"] = "SENT";
})(NotificationStatus || (NotificationStatus = {}));
export var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["Cash"] = "CASH";
    PaymentMethod["MoneyTransfer"] = "MONEY_TRANSFER";
})(PaymentMethod || (PaymentMethod = {}));
export var PeriodType;
(function (PeriodType) {
    PeriodType["Monthly"] = "MONTHLY";
    PeriodType["Weekly"] = "WEEKLY";
})(PeriodType || (PeriodType = {}));
export var ReportType;
(function (ReportType) {
    ReportType["CreditosConErrores"] = "CREDITOS_CON_ERRORES";
    ReportType["NotificacionTiempoReal"] = "NOTIFICACION_TIEMPO_REAL";
})(ReportType || (ReportType = {}));
export var TransactionType;
(function (TransactionType) {
    TransactionType["Expense"] = "EXPENSE";
    TransactionType["Income"] = "INCOME";
    TransactionType["Investment"] = "INVESTMENT";
    TransactionType["Transfer"] = "TRANSFER";
})(TransactionType || (TransactionType = {}));
export var Trend;
(function (Trend) {
    Trend["Down"] = "DOWN";
    Trend["Stable"] = "STABLE";
    Trend["Up"] = "UP";
})(Trend || (Trend = {}));
export var UserRole;
(function (UserRole) {
    UserRole["Admin"] = "ADMIN";
    UserRole["Captura"] = "CAPTURA";
    UserRole["Normal"] = "NORMAL";
})(UserRole || (UserRole = {}));

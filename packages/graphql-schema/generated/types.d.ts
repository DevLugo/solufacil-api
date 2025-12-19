import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import { GraphQLContext } from '../src/context';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends {
    [key: string]: unknown;
}> = {
    [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
    [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
    [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<T extends {
    [key: string]: unknown;
}, K extends keyof T> = {
    [_ in K]?: never;
};
export type Incremental<T> = T | {
    [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never;
};
export type RequireFields<T, K extends keyof T> = Omit<T, K> & {
    [P in K]-?: NonNullable<T[P]>;
};
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
    ID: {
        input: string;
        output: string;
    };
    String: {
        input: string;
        output: string;
    };
    Boolean: {
        input: boolean;
        output: boolean;
    };
    Int: {
        input: number;
        output: number;
    };
    Float: {
        input: number;
        output: number;
    };
    DateTime: {
        input: Date;
        output: Date;
    };
    Decimal: {
        input: string;
        output: string;
    };
    JSON: {
        input: Record<string, any>;
        output: Record<string, any>;
    };
    Upload: {
        input: Promise<{
            createReadStream: () => NodeJS.ReadableStream;
            filename: string;
            mimetype: string;
            encoding: string;
        }>;
        output: Promise<{
            createReadStream: () => NodeJS.ReadableStream;
            filename: string;
            mimetype: string;
            encoding: string;
        }>;
    };
};
export type Account = {
    __typename?: 'Account';
    accountBalance: Scalars['Decimal']['output'];
    amount: Scalars['Decimal']['output'];
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    routes: Array<Route>;
    transactionsDestination: Array<Transaction>;
    transactionsSource: Array<Transaction>;
    type: AccountType;
    updatedAt: Scalars['DateTime']['output'];
};
export declare enum AccountType {
    Bank = "BANK",
    EmployeeCashFund = "EMPLOYEE_CASH_FUND",
    OfficeCashFund = "OFFICE_CASH_FUND",
    PrepaidGas = "PREPAID_GAS",
    TravelExpenses = "TRAVEL_EXPENSES"
}
export type ActiveClientStatus = {
    __typename?: 'ActiveClientStatus';
    borrowerId: Scalars['ID']['output'];
    clientName: Scalars['String']['output'];
    cvStatus: CvStatus;
    daysSinceLastPayment?: Maybe<Scalars['Int']['output']>;
    loanId: Scalars['ID']['output'];
    locationName: Scalars['String']['output'];
    pendingAmount: Scalars['Decimal']['output'];
    routeName: Scalars['String']['output'];
};
export type ActiveLoansBreakdown = {
    __typename?: 'ActiveLoansBreakdown';
    alCorriente: Scalars['Int']['output'];
    carteraVencida: Scalars['Int']['output'];
    total: Scalars['Int']['output'];
};
export type Address = {
    __typename?: 'Address';
    id: Scalars['ID']['output'];
    location: Location;
    numberExterior?: Maybe<Scalars['String']['output']>;
    numberInterior?: Maybe<Scalars['String']['output']>;
    personalData: PersonalData;
    street: Scalars['String']['output'];
    zipCode?: Maybe<Scalars['String']['output']>;
};
export type AnnualFinancialReport = {
    __typename?: 'AnnualFinancialReport';
    annualWeeklyAverageExpenses: Scalars['Decimal']['output'];
    annualWeeklyAverageIncome: Scalars['Decimal']['output'];
    annualWeeklyAverageProfit: Scalars['Decimal']['output'];
    data: Array<MonthlyFinancialData>;
    months: Array<Scalars['String']['output']>;
    routes: Array<RouteInfo>;
    totalActiveWeeks: Scalars['Int']['output'];
    year: Scalars['Int']['output'];
};
export type AuthPayload = {
    __typename?: 'AuthPayload';
    accessToken: Scalars['String']['output'];
    refreshToken: Scalars['String']['output'];
    user: User;
};
export type BadDebtData = {
    __typename?: 'BadDebtData';
    loanCount: Scalars['Int']['output'];
    routeId: Scalars['ID']['output'];
    routeName: Scalars['String']['output'];
    totalAmount: Scalars['Decimal']['output'];
};
export type BadDebtSummary = {
    __typename?: 'BadDebtSummary';
    byRoute: Array<BadDebtData>;
    totalAmount: Scalars['Decimal']['output'];
    totalLoans: Scalars['Int']['output'];
};
export type BankIncomeTransaction = {
    __typename?: 'BankIncomeTransaction';
    amount: Scalars['Float']['output'];
    date: Scalars['DateTime']['output'];
    description?: Maybe<Scalars['String']['output']>;
    employeeName?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    incomeSource?: Maybe<Scalars['String']['output']>;
    isClientPayment: Scalars['Boolean']['output'];
    isLeaderPayment: Scalars['Boolean']['output'];
    leaderLocality?: Maybe<Scalars['String']['output']>;
    locality?: Maybe<Scalars['String']['output']>;
    name: Scalars['String']['output'];
    type: Scalars['String']['output'];
};
export type BankIncomeTransactionsResponse = {
    __typename?: 'BankIncomeTransactionsResponse';
    message?: Maybe<Scalars['String']['output']>;
    success: Scalars['Boolean']['output'];
    transactions: Array<BankIncomeTransaction>;
};
export type BatchTransferResult = {
    __typename?: 'BatchTransferResult';
    message: Scalars['String']['output'];
    success: Scalars['Boolean']['output'];
    totalAmount: Scalars['Decimal']['output'];
    transactions: Array<Transaction>;
    transactionsCreated: Scalars['Int']['output'];
};
export type Borrower = {
    __typename?: 'Borrower';
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    loanFinishedCount: Scalars['Int']['output'];
    loans: Array<Loan>;
    personalData: PersonalData;
    updatedAt: Scalars['DateTime']['output'];
};
export type BorrowerSearchResult = {
    __typename?: 'BorrowerSearchResult';
    hasActiveLoans: Scalars['Boolean']['output'];
    id: Scalars['ID']['output'];
    isFromCurrentLocation: Scalars['Boolean']['output'];
    loanFinishedCount: Scalars['Int']['output'];
    locationId?: Maybe<Scalars['ID']['output']>;
    locationName?: Maybe<Scalars['String']['output']>;
    pendingDebtAmount?: Maybe<Scalars['String']['output']>;
    personalData: PersonalData;
};
export declare enum CvStatus {
    AlCorriente = "AL_CORRIENTE",
    EnCv = "EN_CV",
    Excluido = "EXCLUIDO"
}
export type CleanupLoanPreview = {
    __typename?: 'CleanupLoanPreview';
    clientCode: Scalars['String']['output'];
    clientName: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    pendingAmount: Scalars['Decimal']['output'];
    routeName: Scalars['String']['output'];
    signDate: Scalars['DateTime']['output'];
};
export type CleanupPreview = {
    __typename?: 'CleanupPreview';
    sampleLoans: Array<CleanupLoanPreview>;
    totalLoans: Scalars['Int']['output'];
    totalPendingAmount: Scalars['Decimal']['output'];
};
export type ClientAddressInfo = {
    __typename?: 'ClientAddressInfo';
    city?: Maybe<Scalars['String']['output']>;
    location: Scalars['String']['output'];
    route: Scalars['String']['output'];
    street: Scalars['String']['output'];
};
export type ClientBalanceData = {
    __typename?: 'ClientBalanceData';
    balance: Scalars['Int']['output'];
    nuevos: Scalars['Int']['output'];
    renovados: Scalars['Int']['output'];
    terminadosSinRenovar: Scalars['Int']['output'];
    trend: Trend;
};
export declare enum ClientCategory {
    Activo = "ACTIVO",
    EnCv = "EN_CV",
    Finalizado = "FINALIZADO",
    Nuevo = "NUEVO",
    Reintegro = "REINTEGRO",
    Renovado = "RENOVADO"
}
export type ClientHistoryData = {
    __typename?: 'ClientHistoryData';
    client: ClientInfo;
    loansAsClient: Array<LoanHistoryDetail>;
    loansAsCollateral: Array<LoanHistoryDetail>;
    summary: ClientSummary;
};
export type ClientInfo = {
    __typename?: 'ClientInfo';
    addresses: Array<ClientAddressInfo>;
    clientCode: Scalars['String']['output'];
    fullName: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    leader?: Maybe<LeaderInfo>;
    phones: Array<Scalars['String']['output']>;
};
export type ClientSearchResult = {
    __typename?: 'ClientSearchResult';
    activeLoans: Scalars['Int']['output'];
    address?: Maybe<Scalars['String']['output']>;
    clientCode: Scalars['String']['output'];
    collateralLoans: Scalars['Int']['output'];
    finishedLoans: Scalars['Int']['output'];
    hasBeenCollateral: Scalars['Boolean']['output'];
    hasLoans: Scalars['Boolean']['output'];
    id: Scalars['ID']['output'];
    latestLoanDate?: Maybe<Scalars['DateTime']['output']>;
    location?: Maybe<Scalars['String']['output']>;
    municipality?: Maybe<Scalars['String']['output']>;
    name: Scalars['String']['output'];
    phone?: Maybe<Scalars['String']['output']>;
    route?: Maybe<Scalars['String']['output']>;
    state?: Maybe<Scalars['String']['output']>;
    totalLoans: Scalars['Int']['output'];
};
export type ClientSummary = {
    __typename?: 'ClientSummary';
    activeLoansAsClient: Scalars['Int']['output'];
    activeLoansAsCollateral: Scalars['Int']['output'];
    currentPendingDebtAsClient: Scalars['Decimal']['output'];
    hasBeenClient: Scalars['Boolean']['output'];
    hasBeenCollateral: Scalars['Boolean']['output'];
    totalAmountPaidAsClient: Scalars['Decimal']['output'];
    totalAmountRequestedAsClient: Scalars['Decimal']['output'];
    totalLoansAsClient: Scalars['Int']['output'];
    totalLoansAsCollateral: Scalars['Int']['output'];
};
export type CommissionPayment = {
    __typename?: 'CommissionPayment';
    amount: Scalars['Decimal']['output'];
    createdAt: Scalars['DateTime']['output'];
    employee: Employee;
    id: Scalars['ID']['output'];
    loan: Loan;
    updatedAt: Scalars['DateTime']['output'];
};
export type ComparisonData = {
    __typename?: 'ComparisonData';
    growth: Scalars['Decimal']['output'];
    previousMonth: FinancialSummary;
    trend: Scalars['String']['output'];
};
export type CreateAccountInput = {
    amount: Scalars['Decimal']['input'];
    name: Scalars['String']['input'];
    routeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    type: AccountType;
};
export type CreateAddressInput = {
    locationId: Scalars['ID']['input'];
    numberExterior?: InputMaybe<Scalars['String']['input']>;
    numberInterior?: InputMaybe<Scalars['String']['input']>;
    street: Scalars['String']['input'];
    zipCode?: InputMaybe<Scalars['String']['input']>;
};
export type CreateBorrowerInput = {
    personalData: CreatePersonalDataInput;
};
export type CreateEmployeeInput = {
    personalData: CreatePersonalDataInput;
    routeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    type: EmployeeType;
};
export type CreateLeadPaymentReceivedInput = {
    agentId: Scalars['ID']['input'];
    bankPaidAmount: Scalars['Decimal']['input'];
    cashPaidAmount: Scalars['Decimal']['input'];
    expectedAmount: Scalars['Decimal']['input'];
    falcoAmount?: InputMaybe<Scalars['Decimal']['input']>;
    leadId: Scalars['ID']['input'];
    paidAmount: Scalars['Decimal']['input'];
    paymentDate: Scalars['DateTime']['input'];
    payments: Array<PaymentForLeadInput>;
};
export type CreateLoanInput = {
    amountGived: Scalars['Decimal']['input'];
    borrowerId: Scalars['ID']['input'];
    collateralIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    grantorId: Scalars['ID']['input'];
    leadId: Scalars['ID']['input'];
    loantypeId: Scalars['ID']['input'];
    previousLoanId?: InputMaybe<Scalars['ID']['input']>;
    requestedAmount: Scalars['Decimal']['input'];
    signDate: Scalars['DateTime']['input'];
};
export type CreateLoanPaymentInput = {
    amount: Scalars['Decimal']['input'];
    comission?: InputMaybe<Scalars['Decimal']['input']>;
    loanId: Scalars['ID']['input'];
    paymentMethod: PaymentMethod;
    receivedAt: Scalars['DateTime']['input'];
};
export type CreateLoansInBatchInput = {
    grantorId: Scalars['ID']['input'];
    leadId: Scalars['ID']['input'];
    loans: Array<CreateSingleLoanInput>;
    signDate: Scalars['DateTime']['input'];
    sourceAccountId: Scalars['ID']['input'];
};
export type CreateLoantypeInput = {
    interestRate: Scalars['Decimal']['input'];
    loanGrantedComission: Scalars['Decimal']['input'];
    loanPaymentComission: Scalars['Decimal']['input'];
    maxAmount?: InputMaybe<Scalars['Decimal']['input']>;
    maxTerm?: InputMaybe<Scalars['Int']['input']>;
    name: Scalars['String']['input'];
    rate: Scalars['Decimal']['input'];
    weekDuration: Scalars['Int']['input'];
};
export type CreateLocationInput = {
    municipalityId: Scalars['ID']['input'];
    name: Scalars['String']['input'];
    routeId: Scalars['ID']['input'];
};
export type CreateNewLeaderInput = {
    birthDate?: InputMaybe<Scalars['DateTime']['input']>;
    fullName: Scalars['String']['input'];
    locationId: Scalars['ID']['input'];
    phone?: InputMaybe<Scalars['String']['input']>;
    replaceExisting?: InputMaybe<Scalars['Boolean']['input']>;
    routeId: Scalars['ID']['input'];
};
export type CreateNewLeaderResult = {
    __typename?: 'CreateNewLeaderResult';
    loansTransferred?: Maybe<Scalars['Int']['output']>;
    message: Scalars['String']['output'];
    newLeaderId?: Maybe<Scalars['ID']['output']>;
    success: Scalars['Boolean']['output'];
};
export type CreatePersonalDataInput = {
    addresses?: InputMaybe<Array<CreateAddressInput>>;
    birthDate?: InputMaybe<Scalars['DateTime']['input']>;
    clientCode?: InputMaybe<Scalars['String']['input']>;
    fullName: Scalars['String']['input'];
    phones?: InputMaybe<Array<CreatePhoneInput>>;
};
export type CreatePhoneInput = {
    number: Scalars['String']['input'];
};
export type CreatePortfolioCleanupInput = {
    cleanupDate: Scalars['DateTime']['input'];
    description?: InputMaybe<Scalars['String']['input']>;
    maxSignDate: Scalars['DateTime']['input'];
    name: Scalars['String']['input'];
    routeId?: InputMaybe<Scalars['String']['input']>;
};
export type CreateReportConfigInput = {
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
    name: Scalars['String']['input'];
    recipientIds: Array<Scalars['ID']['input']>;
    reportType: ReportType;
    routeIds: Array<Scalars['ID']['input']>;
    schedule: ReportScheduleInput;
};
export type CreateRouteInput = {
    name: Scalars['String']['input'];
};
export type CreateSingleLoanInput = {
    amountGived: Scalars['Decimal']['input'];
    borrowerId?: InputMaybe<Scalars['ID']['input']>;
    collateralIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    comissionAmount?: InputMaybe<Scalars['Decimal']['input']>;
    firstPayment?: InputMaybe<FirstPaymentInput>;
    isFromDifferentLocation?: InputMaybe<Scalars['Boolean']['input']>;
    loantypeId: Scalars['ID']['input'];
    newBorrower?: InputMaybe<CreateBorrowerInput>;
    newCollateral?: InputMaybe<CreatePersonalDataInput>;
    previousLoanId?: InputMaybe<Scalars['ID']['input']>;
    requestedAmount: Scalars['Decimal']['input'];
    tempId: Scalars['String']['input'];
};
export type CreateTransactionInput = {
    amount: Scalars['Decimal']['input'];
    date: Scalars['DateTime']['input'];
    destinationAccountId?: InputMaybe<Scalars['ID']['input']>;
    expenseSource?: InputMaybe<Scalars['String']['input']>;
    incomeSource?: InputMaybe<Scalars['String']['input']>;
    leadId?: InputMaybe<Scalars['ID']['input']>;
    loanId?: InputMaybe<Scalars['ID']['input']>;
    loanPaymentId?: InputMaybe<Scalars['ID']['input']>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
    sourceAccountId?: InputMaybe<Scalars['ID']['input']>;
    type: TransactionType;
};
export type CreateUserInput = {
    createEmployee?: InputMaybe<Scalars['Boolean']['input']>;
    email: Scalars['String']['input'];
    employeeId?: InputMaybe<Scalars['ID']['input']>;
    employeeType?: InputMaybe<EmployeeType>;
    name: Scalars['String']['input'];
    password: Scalars['String']['input'];
    role: UserRole;
    telegramChatId?: InputMaybe<Scalars['String']['input']>;
};
export type DeadDebtBorrower = {
    __typename?: 'DeadDebtBorrower';
    clientCode: Scalars['String']['output'];
    fullName: Scalars['String']['output'];
};
export type DeadDebtCriteria = {
    __typename?: 'DeadDebtCriteria';
    badDebtStatus?: Maybe<Scalars['String']['output']>;
    localities: Array<Scalars['String']['output']>;
    weeksSinceLoanMin?: Maybe<Scalars['Int']['output']>;
    weeksWithoutPaymentMin?: Maybe<Scalars['Int']['output']>;
};
export type DeadDebtLead = {
    __typename?: 'DeadDebtLead';
    fullName: Scalars['String']['output'];
    locality: Scalars['String']['output'];
    route: Scalars['String']['output'];
};
export type DeadDebtLoan = {
    __typename?: 'DeadDebtLoan';
    amountGived: Scalars['Decimal']['output'];
    badDebtCandidate: Scalars['Decimal']['output'];
    badDebtDate?: Maybe<Scalars['DateTime']['output']>;
    borrower: DeadDebtBorrower;
    id: Scalars['ID']['output'];
    lead: DeadDebtLead;
    payments: Array<DeadDebtPayment>;
    pendingAmountStored: Scalars['Decimal']['output'];
    signDate: Scalars['DateTime']['output'];
    weeksSinceLoan: Scalars['Int']['output'];
    weeksWithoutPayment: Scalars['Int']['output'];
};
export type DeadDebtMonthSummary = {
    __typename?: 'DeadDebtMonthSummary';
    criteria: DeadDebtCriteria;
    evaluationPeriod: EvaluationPeriod;
    loans: Array<DeadDebtLoan>;
    month: MonthInfo;
    summary: DeadDebtTotals;
};
export type DeadDebtMonthlySummaryResult = {
    __typename?: 'DeadDebtMonthlySummaryResult';
    monthlySummary: Array<DeadDebtMonthSummary>;
    routesInfo: Array<RouteInfo>;
    year: Scalars['Int']['output'];
    yearTotals: DeadDebtTotals;
};
export type DeadDebtPayment = {
    __typename?: 'DeadDebtPayment';
    amount: Scalars['Decimal']['output'];
    receivedAt?: Maybe<Scalars['DateTime']['output']>;
};
export type DeadDebtQueryResult = {
    __typename?: 'DeadDebtQueryResult';
    loans: Array<DeadDebtLoan>;
    localities: Array<Scalars['String']['output']>;
    summary: DeadDebtTotals;
};
export declare enum DeadDebtStatus {
    All = "ALL",
    Marked = "MARKED",
    Unmarked = "UNMARKED"
}
export type DeadDebtSummaryByLocality = {
    __typename?: 'DeadDebtSummaryByLocality';
    loanCount: Scalars['Int']['output'];
    locality: Scalars['String']['output'];
    totalBadDebtCandidate: Scalars['Decimal']['output'];
    totalPending: Scalars['Decimal']['output'];
};
export type DeadDebtTotals = {
    __typename?: 'DeadDebtTotals';
    totalBadDebtCandidate: Scalars['Decimal']['output'];
    totalLoans: Scalars['Int']['output'];
    totalPendingAmount: Scalars['Decimal']['output'];
};
export type DistributeMoneyInput = {
    description?: InputMaybe<Scalars['String']['input']>;
    distributionMode: DistributionMode;
    fixedAmount?: InputMaybe<Scalars['Decimal']['input']>;
    routeIds: Array<Scalars['ID']['input']>;
    sourceAccountId: Scalars['ID']['input'];
    variableAmounts?: InputMaybe<Array<RouteAmountInput>>;
};
export declare enum DistributionMode {
    FixedEqual = "FIXED_EQUAL",
    Variable = "VARIABLE"
}
export type DocumentNotificationLog = {
    __typename?: 'DocumentNotificationLog';
    createdAt: Scalars['DateTime']['output'];
    description?: Maybe<Scalars['String']['output']>;
    documentId: Scalars['String']['output'];
    documentType: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    issueType: IssueType;
    lastRetryAt?: Maybe<Scalars['DateTime']['output']>;
    loanId?: Maybe<Scalars['String']['output']>;
    localityName?: Maybe<Scalars['String']['output']>;
    messageContent: Scalars['String']['output'];
    notes?: Maybe<Scalars['String']['output']>;
    personName: Scalars['String']['output'];
    personalDataId: Scalars['String']['output'];
    responseTimeMs?: Maybe<Scalars['Int']['output']>;
    retryCount: Scalars['Int']['output'];
    routeId: Scalars['String']['output'];
    routeLeadId?: Maybe<Scalars['String']['output']>;
    routeLeadName?: Maybe<Scalars['String']['output']>;
    routeName: Scalars['String']['output'];
    sentAt?: Maybe<Scalars['DateTime']['output']>;
    status: NotificationStatus;
    telegramChatId: Scalars['String']['output'];
    telegramErrorCode?: Maybe<Scalars['Int']['output']>;
    telegramErrorMessage?: Maybe<Scalars['String']['output']>;
    telegramResponse?: Maybe<Scalars['String']['output']>;
    telegramUserId: Scalars['String']['output'];
    telegramUsername?: Maybe<Scalars['String']['output']>;
};
export type DocumentPhoto = {
    __typename?: 'DocumentPhoto';
    createdAt: Scalars['DateTime']['output'];
    description?: Maybe<Scalars['String']['output']>;
    documentType: DocumentType;
    errorDescription?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    isError: Scalars['Boolean']['output'];
    isMissing: Scalars['Boolean']['output'];
    loan?: Maybe<Loan>;
    personalData?: Maybe<PersonalData>;
    photoUrl?: Maybe<Scalars['String']['output']>;
    publicId?: Maybe<Scalars['String']['output']>;
    title?: Maybe<Scalars['String']['output']>;
    updatedAt: Scalars['DateTime']['output'];
    uploadedBy?: Maybe<User>;
};
export declare enum DocumentType {
    Domicilio = "DOMICILIO",
    Ine = "INE",
    Otro = "OTRO",
    Pagare = "PAGARE"
}
export type DocumentWithNotificationStatus = {
    __typename?: 'DocumentWithNotificationStatus';
    document: DocumentPhoto;
    lastNotification?: Maybe<DocumentNotificationLog>;
    notificationSent: Scalars['Boolean']['output'];
};
export type DrainRoutesInput = {
    description?: InputMaybe<Scalars['String']['input']>;
    destinationAccountId: Scalars['ID']['input'];
    routeIds: Array<Scalars['ID']['input']>;
};
export type Employee = {
    __typename?: 'Employee';
    commissionPayments: Array<CommissionPayment>;
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    loansGranted: Array<Loan>;
    loansManagedAsLead: Array<Loan>;
    location?: Maybe<Location>;
    personalData: PersonalData;
    routes: Array<Route>;
    transactions: Array<Transaction>;
    type: EmployeeType;
    updatedAt: Scalars['DateTime']['output'];
    user?: Maybe<User>;
};
export declare enum EmployeeType {
    Lead = "LEAD",
    RouteAssistent = "ROUTE_ASSISTENT",
    RouteLead = "ROUTE_LEAD"
}
/** Employee with individual statistics */
export type EmployeeWithStats = {
    __typename?: 'EmployeeWithStats';
    activos: Scalars['Int']['output'];
    alCorriente: Scalars['Int']['output'];
    enCV: Scalars['Int']['output'];
    id: Scalars['ID']['output'];
    personalData?: Maybe<PersonalData>;
    type: EmployeeType;
};
export type EvaluationPeriod = {
    __typename?: 'EvaluationPeriod';
    description: Scalars['String']['output'];
    from: Scalars['DateTime']['output'];
    to: Scalars['DateTime']['output'];
};
export type ExistingLeaderInfo = {
    __typename?: 'ExistingLeaderInfo';
    fullName: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    locationName: Scalars['String']['output'];
};
export type FinancialReport = {
    __typename?: 'FinancialReport';
    comparisonData?: Maybe<ComparisonData>;
    performanceMetrics: PerformanceMetrics;
    summary: FinancialSummary;
    weeklyData: Array<WeeklyData>;
};
export type FinancialSummary = {
    __typename?: 'FinancialSummary';
    activeLoans: Scalars['Int']['output'];
    activeLoansBreakdown: ActiveLoansBreakdown;
    averagePayment: Scalars['Decimal']['output'];
    pendingAmount: Scalars['Decimal']['output'];
    totalPaid: Scalars['Decimal']['output'];
    totalPortfolio: Scalars['Decimal']['output'];
};
export type FirstPaymentInput = {
    amount: Scalars['Decimal']['input'];
    comission?: InputMaybe<Scalars['Decimal']['input']>;
    paymentMethod: PaymentMethod;
};
export declare enum IssueType {
    Error = "ERROR",
    Missing = "MISSING"
}
export type LeadPaymentReceived = {
    __typename?: 'LeadPaymentReceived';
    agent: Employee;
    bankPaidAmount: Scalars['Decimal']['output'];
    cashPaidAmount: Scalars['Decimal']['output'];
    createdAt: Scalars['DateTime']['output'];
    expectedAmount: Scalars['Decimal']['output'];
    falcoAmount: Scalars['Decimal']['output'];
    id: Scalars['ID']['output'];
    lead: Employee;
    paidAmount: Scalars['Decimal']['output'];
    paymentStatus: Scalars['String']['output'];
    payments: Array<LoanPayment>;
    updatedAt: Scalars['DateTime']['output'];
};
export type LeaderInfo = {
    __typename?: 'LeaderInfo';
    location: Scalars['String']['output'];
    municipality?: Maybe<Scalars['String']['output']>;
    name: Scalars['String']['output'];
    phone?: Maybe<Scalars['String']['output']>;
    route: Scalars['String']['output'];
    state?: Maybe<Scalars['String']['output']>;
};
export type LinkTelegramToUserInput = {
    platformUserId: Scalars['ID']['input'];
    telegramUserId: Scalars['ID']['input'];
};
export type Loan = {
    __typename?: 'Loan';
    amountGived: Scalars['Decimal']['output'];
    badDebtDate?: Maybe<Scalars['DateTime']['output']>;
    borrower: Borrower;
    collaterals: Array<PersonalData>;
    comissionAmount: Scalars['Decimal']['output'];
    createdAt: Scalars['DateTime']['output'];
    documentPhotos: Array<DocumentPhoto>;
    expectedWeeklyPayment: Scalars['Decimal']['output'];
    finishedDate?: Maybe<Scalars['DateTime']['output']>;
    grantor: Employee;
    id: Scalars['ID']['output'];
    isDeceased: Scalars['Boolean']['output'];
    lead: Employee;
    loantype: Loantype;
    payments: Array<LoanPayment>;
    pendingAmountStored: Scalars['Decimal']['output'];
    previousLoan?: Maybe<Loan>;
    profitAmount: Scalars['Decimal']['output'];
    renewedBy?: Maybe<Loan>;
    requestedAmount: Scalars['Decimal']['output'];
    signDate: Scalars['DateTime']['output'];
    snapshotLeadAssignedAt?: Maybe<Scalars['DateTime']['output']>;
    snapshotLeadId?: Maybe<Scalars['String']['output']>;
    snapshotLeadName?: Maybe<Scalars['String']['output']>;
    snapshotRouteId?: Maybe<Scalars['String']['output']>;
    snapshotRouteName?: Maybe<Scalars['String']['output']>;
    status: LoanStatus;
    totalDebtAcquired: Scalars['Decimal']['output'];
    totalPaid: Scalars['Decimal']['output'];
    transactions: Array<Transaction>;
    updatedAt: Scalars['DateTime']['output'];
};
export type LoanConnection = {
    __typename?: 'LoanConnection';
    edges: Array<LoanEdge>;
    pageInfo: PageInfo;
    totalCount: Scalars['Int']['output'];
};
export type LoanEdge = {
    __typename?: 'LoanEdge';
    cursor: Scalars['String']['output'];
    node: Loan;
};
export type LoanHistoryDetail = {
    __typename?: 'LoanHistoryDetail';
    amountRequested: Scalars['Decimal']['output'];
    avalName?: Maybe<Scalars['String']['output']>;
    avalPhone?: Maybe<Scalars['String']['output']>;
    clientDui?: Maybe<Scalars['String']['output']>;
    clientName?: Maybe<Scalars['String']['output']>;
    daysSinceSign: Scalars['Int']['output'];
    finishedDate?: Maybe<Scalars['DateTime']['output']>;
    finishedDateFormatted?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    interestAmount: Scalars['Decimal']['output'];
    leadName?: Maybe<Scalars['String']['output']>;
    loanType: Scalars['String']['output'];
    noPaymentPeriods: Array<NoPaymentPeriod>;
    payments: Array<LoanPaymentDetail>;
    paymentsCount: Scalars['Int']['output'];
    pendingDebt: Scalars['Decimal']['output'];
    rate: Scalars['Decimal']['output'];
    renewedDate?: Maybe<Scalars['DateTime']['output']>;
    renewedFrom?: Maybe<Scalars['ID']['output']>;
    renewedTo?: Maybe<Scalars['ID']['output']>;
    routeName?: Maybe<Scalars['String']['output']>;
    signDate: Scalars['DateTime']['output'];
    signDateFormatted: Scalars['String']['output'];
    status: Scalars['String']['output'];
    totalAmountDue: Scalars['Decimal']['output'];
    totalPaid: Scalars['Decimal']['output'];
    wasRenewed: Scalars['Boolean']['output'];
    weekDuration: Scalars['Int']['output'];
};
export type LoanPayment = {
    __typename?: 'LoanPayment';
    amount: Scalars['Decimal']['output'];
    comission: Scalars['Decimal']['output'];
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    leadPaymentReceived?: Maybe<LeadPaymentReceived>;
    loan: Loan;
    paymentMethod: PaymentMethod;
    receivedAt: Scalars['DateTime']['output'];
    transactions: Array<Transaction>;
    type: Scalars['String']['output'];
    updatedAt: Scalars['DateTime']['output'];
};
export type LoanPaymentDetail = {
    __typename?: 'LoanPaymentDetail';
    amount: Scalars['Decimal']['output'];
    balanceAfterPayment: Scalars['Decimal']['output'];
    balanceBeforePayment: Scalars['Decimal']['output'];
    id: Scalars['ID']['output'];
    paymentMethod: Scalars['String']['output'];
    paymentNumber: Scalars['Int']['output'];
    receivedAt: Scalars['DateTime']['output'];
    receivedAtFormatted: Scalars['String']['output'];
    type: Scalars['String']['output'];
};
export declare enum LoanStatus {
    Active = "ACTIVE",
    Cancelled = "CANCELLED",
    Finished = "FINISHED",
    Renovated = "RENOVATED"
}
export type Loantype = {
    __typename?: 'Loantype';
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    loanGrantedComission: Scalars['Decimal']['output'];
    loanPaymentComission: Scalars['Decimal']['output'];
    name: Scalars['String']['output'];
    rate: Scalars['Decimal']['output'];
    updatedAt: Scalars['DateTime']['output'];
    weekDuration: Scalars['Int']['output'];
};
export type LocalityBreakdownDetail = {
    __typename?: 'LocalityBreakdownDetail';
    localityId: Scalars['ID']['output'];
    localityName: Scalars['String']['output'];
    routeId?: Maybe<Scalars['ID']['output']>;
    routeName?: Maybe<Scalars['String']['output']>;
    summary: LocalitySummary;
    weeklyData: Array<LocalityWeekData>;
};
export type LocalityClientDetail = {
    __typename?: 'LocalityClientDetail';
    amountGived: Scalars['Decimal']['output'];
    category: ClientCategory;
    clientCode: Scalars['String']['output'];
    clientName: Scalars['String']['output'];
    cvStatus: CvStatus;
    daysSinceLastPayment?: Maybe<Scalars['Int']['output']>;
    loanId: Scalars['ID']['output'];
    loanType: Scalars['String']['output'];
    pendingAmount: Scalars['Decimal']['output'];
    signDate: Scalars['DateTime']['output'];
};
export type LocalityReport = {
    __typename?: 'LocalityReport';
    localities: Array<LocalityBreakdownDetail>;
    month?: Maybe<Scalars['Int']['output']>;
    periodType: PeriodType;
    totals: LocalitySummary;
    weekNumber?: Maybe<Scalars['Int']['output']>;
    weeks: Array<WeekRange>;
    year: Scalars['Int']['output'];
};
export type LocalitySummary = {
    __typename?: 'LocalitySummary';
    alCorrientePromedio: Scalars['Float']['output'];
    balance: Scalars['Int']['output'];
    cvPromedio: Scalars['Float']['output'];
    porcentajePagando: Scalars['Float']['output'];
    totalClientesActivos: Scalars['Int']['output'];
    totalClientesAlCorriente: Scalars['Int']['output'];
    totalClientesEnCV: Scalars['Int']['output'];
    totalFinalizados: Scalars['Int']['output'];
    totalNuevos: Scalars['Int']['output'];
    totalReintegros: Scalars['Int']['output'];
    totalRenovados: Scalars['Int']['output'];
};
export type LocalityWeekData = {
    __typename?: 'LocalityWeekData';
    balance: Scalars['Int']['output'];
    clientesActivos: Scalars['Int']['output'];
    clientesAlCorriente: Scalars['Int']['output'];
    clientesEnCV: Scalars['Int']['output'];
    finalizados: Scalars['Int']['output'];
    /** Si la semana ya está completada (pasó el domingo) */
    isCompleted: Scalars['Boolean']['output'];
    nuevos: Scalars['Int']['output'];
    reintegros: Scalars['Int']['output'];
    renovados: Scalars['Int']['output'];
    weekRange: WeekRange;
};
export type Location = {
    __typename?: 'Location';
    addresses: Array<Address>;
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    municipality: Municipality;
    name: Scalars['String']['output'];
    route?: Maybe<Route>;
};
export type LocationBreakdown = {
    __typename?: 'LocationBreakdown';
    balance: Scalars['Int']['output'];
    clientesActivos: Scalars['Int']['output'];
    clientesAlCorriente: Scalars['Int']['output'];
    clientesEnCV: Scalars['Int']['output'];
    locationId: Scalars['ID']['output'];
    locationName: Scalars['String']['output'];
    routeId?: Maybe<Scalars['ID']['output']>;
    routeName?: Maybe<Scalars['String']['output']>;
};
export type MarkDeadDebtResult = {
    __typename?: 'MarkDeadDebtResult';
    count: Scalars['Int']['output'];
    message: Scalars['String']['output'];
    success: Scalars['Boolean']['output'];
};
export type MarkDocumentAsMissingInput = {
    documentType: DocumentType;
    loanId: Scalars['ID']['input'];
    personalDataId: Scalars['ID']['input'];
};
export type MonthInfo = {
    __typename?: 'MonthInfo';
    endDate: Scalars['DateTime']['output'];
    month: Scalars['Int']['output'];
    name: Scalars['String']['output'];
    startDate: Scalars['DateTime']['output'];
    year: Scalars['Int']['output'];
};
export type MonthlyFinancialData = {
    __typename?: 'MonthlyFinancialData';
    activeWeeks: Scalars['Int']['output'];
    availableCash: Scalars['Decimal']['output'];
    badDebtAmount: Scalars['Decimal']['output'];
    capitalReturn: Scalars['Decimal']['output'];
    carteraActiva: Scalars['Int']['output'];
    carteraMuerta: Scalars['Decimal']['output'];
    carteraVencida: Scalars['Int']['output'];
    cashGasolina: Scalars['Decimal']['output'];
    comissions: Scalars['Decimal']['output'];
    gainPerPayment: Scalars['Decimal']['output'];
    generalExpenses: Scalars['Decimal']['output'];
    incomes: Scalars['Decimal']['output'];
    loanDisbursements: Scalars['Decimal']['output'];
    month: Scalars['String']['output'];
    nomina: Scalars['Decimal']['output'];
    nominaInterna: Scalars['Decimal']['output'];
    operationalCashUsed: Scalars['Decimal']['output'];
    operationalProfit: Scalars['Decimal']['output'];
    paymentsCount: Scalars['Int']['output'];
    profitPercentage: Scalars['Decimal']['output'];
    profitReturn: Scalars['Decimal']['output'];
    renovados: Scalars['Int']['output'];
    salarioExterno: Scalars['Decimal']['output'];
    tokaGasolina: Scalars['Decimal']['output'];
    totalExpenses: Scalars['Decimal']['output'];
    totalGasolina: Scalars['Decimal']['output'];
    totalIncomingCash: Scalars['Decimal']['output'];
    totalInvestment: Scalars['Decimal']['output'];
    travelExpenses: Scalars['Decimal']['output'];
    viaticos: Scalars['Decimal']['output'];
    weeklyAverageExpenses: Scalars['Decimal']['output'];
    weeklyAverageIncome: Scalars['Decimal']['output'];
    weeklyAverageProfit: Scalars['Decimal']['output'];
};
export type Municipality = {
    __typename?: 'Municipality';
    id: Scalars['ID']['output'];
    locations: Array<Location>;
    name: Scalars['String']['output'];
    state: State;
};
export type Mutation = {
    __typename?: 'Mutation';
    activateTelegramUser: TelegramUser;
    cancelLoan: Loan;
    cancelLoanWithAccountRestore: Loan;
    changePassword: Scalars['Boolean']['output'];
    createAccount: Account;
    createBorrower: Borrower;
    createEmployee: Employee;
    createLeadPaymentReceived: LeadPaymentReceived;
    createLoan: Loan;
    createLoanPayment: LoanPayment;
    createLoansInBatch: Array<Loan>;
    createLoantype: Loantype;
    createLocation: Location;
    createNewLeader: CreateNewLeaderResult;
    createPortfolioCleanup: PortfolioCleanup;
    createReportConfig: ReportConfig;
    createRoute: Route;
    createTransaction: Transaction;
    createUser: User;
    deactivateTelegramUser: TelegramUser;
    deleteDocumentPhoto: Scalars['Boolean']['output'];
    deleteLoanPayment: LoanPayment;
    deletePortfolioCleanup: Scalars['Boolean']['output'];
    deleteReportConfig: Scalars['Boolean']['output'];
    deleteTelegramUser: Scalars['Boolean']['output'];
    deleteTransaction: Scalars['Boolean']['output'];
    deleteUser: Scalars['Boolean']['output'];
    distributeMoney: BatchTransferResult;
    drainRoutes: BatchTransferResult;
    executeReportManually: ReportExecutionResult;
    finishLoan: Loan;
    generatePortfolioReportPDF: PdfGenerationResult;
    linkTelegramToUser: TelegramUser;
    login: AuthPayload;
    logout: Scalars['Boolean']['output'];
    markDocumentAsMissing: DocumentPhoto;
    markLoanAsBadDebt: Loan;
    markLoansAsDeadDebt: MarkDeadDebtResult;
    promoteToLead: Employee;
    refreshToken: AuthPayload;
    renewLoan: Loan;
    retryFailedNotification: SendNotificationResult;
    sendBulkDocumentNotifications: Array<SendNotificationResult>;
    sendDocumentNotification: SendNotificationResult;
    toggleReportConfig: ReportConfig;
    transferBetweenAccounts: Transaction;
    unlinkTelegramFromUser: TelegramUser;
    updateAccount: Account;
    updateBorrower: Borrower;
    updateDocumentPhoto: DocumentPhoto;
    updateEmployee: Employee;
    updateLeadPaymentReceived: LeadPaymentReceived;
    updateLoan: Loan;
    updateLoanExtended: Loan;
    updateLoanPayment: LoanPayment;
    updateLoantype: Loantype;
    updatePersonalData: PersonalData;
    updatePhone: Phone;
    updatePortfolioCleanup: PortfolioCleanup;
    updateReportConfig: ReportConfig;
    updateRoute: Route;
    updateTelegramUser: TelegramUser;
    updateTransaction: Transaction;
    updateUser: User;
    uploadDocumentPhoto: DocumentPhoto;
};
export type MutationActivateTelegramUserArgs = {
    id: Scalars['ID']['input'];
};
export type MutationCancelLoanArgs = {
    id: Scalars['ID']['input'];
};
export type MutationCancelLoanWithAccountRestoreArgs = {
    accountId: Scalars['ID']['input'];
    id: Scalars['ID']['input'];
};
export type MutationChangePasswordArgs = {
    newPassword: Scalars['String']['input'];
    oldPassword: Scalars['String']['input'];
};
export type MutationCreateAccountArgs = {
    input: CreateAccountInput;
};
export type MutationCreateBorrowerArgs = {
    input: CreateBorrowerInput;
};
export type MutationCreateEmployeeArgs = {
    input: CreateEmployeeInput;
};
export type MutationCreateLeadPaymentReceivedArgs = {
    input: CreateLeadPaymentReceivedInput;
};
export type MutationCreateLoanArgs = {
    input: CreateLoanInput;
};
export type MutationCreateLoanPaymentArgs = {
    input: CreateLoanPaymentInput;
};
export type MutationCreateLoansInBatchArgs = {
    input: CreateLoansInBatchInput;
};
export type MutationCreateLoantypeArgs = {
    input: CreateLoantypeInput;
};
export type MutationCreateLocationArgs = {
    input: CreateLocationInput;
};
export type MutationCreateNewLeaderArgs = {
    input: CreateNewLeaderInput;
};
export type MutationCreatePortfolioCleanupArgs = {
    input: CreatePortfolioCleanupInput;
};
export type MutationCreateReportConfigArgs = {
    input: CreateReportConfigInput;
};
export type MutationCreateRouteArgs = {
    input: CreateRouteInput;
};
export type MutationCreateTransactionArgs = {
    input: CreateTransactionInput;
};
export type MutationCreateUserArgs = {
    input: CreateUserInput;
};
export type MutationDeactivateTelegramUserArgs = {
    id: Scalars['ID']['input'];
};
export type MutationDeleteDocumentPhotoArgs = {
    id: Scalars['ID']['input'];
};
export type MutationDeleteLoanPaymentArgs = {
    id: Scalars['ID']['input'];
};
export type MutationDeletePortfolioCleanupArgs = {
    id: Scalars['ID']['input'];
};
export type MutationDeleteReportConfigArgs = {
    id: Scalars['ID']['input'];
};
export type MutationDeleteTelegramUserArgs = {
    id: Scalars['ID']['input'];
};
export type MutationDeleteTransactionArgs = {
    id: Scalars['ID']['input'];
};
export type MutationDeleteUserArgs = {
    id: Scalars['ID']['input'];
};
export type MutationDistributeMoneyArgs = {
    input: DistributeMoneyInput;
};
export type MutationDrainRoutesArgs = {
    input: DrainRoutesInput;
};
export type MutationExecuteReportManuallyArgs = {
    reportConfigId: Scalars['ID']['input'];
};
export type MutationFinishLoanArgs = {
    loanId: Scalars['ID']['input'];
};
export type MutationGeneratePortfolioReportPdfArgs = {
    filters?: InputMaybe<PortfolioFiltersInput>;
    month?: InputMaybe<Scalars['Int']['input']>;
    periodType: PeriodType;
    weekNumber?: InputMaybe<Scalars['Int']['input']>;
    year: Scalars['Int']['input'];
};
export type MutationLinkTelegramToUserArgs = {
    input: LinkTelegramToUserInput;
};
export type MutationLoginArgs = {
    email: Scalars['String']['input'];
    password: Scalars['String']['input'];
};
export type MutationMarkDocumentAsMissingArgs = {
    input: MarkDocumentAsMissingInput;
};
export type MutationMarkLoanAsBadDebtArgs = {
    badDebtDate: Scalars['DateTime']['input'];
    loanId: Scalars['ID']['input'];
};
export type MutationMarkLoansAsDeadDebtArgs = {
    deadDebtDate: Scalars['DateTime']['input'];
    loanIds: Array<Scalars['ID']['input']>;
};
export type MutationPromoteToLeadArgs = {
    employeeId: Scalars['ID']['input'];
};
export type MutationRefreshTokenArgs = {
    refreshToken: Scalars['String']['input'];
};
export type MutationRenewLoanArgs = {
    input: RenewLoanInput;
    loanId: Scalars['ID']['input'];
};
export type MutationRetryFailedNotificationArgs = {
    notificationId: Scalars['ID']['input'];
};
export type MutationSendBulkDocumentNotificationsArgs = {
    documentIds: Array<Scalars['ID']['input']>;
    includePhoto?: InputMaybe<Scalars['Boolean']['input']>;
    recipientChatIds: Array<Scalars['String']['input']>;
};
export type MutationSendDocumentNotificationArgs = {
    input: SendDocumentNotificationInput;
};
export type MutationToggleReportConfigArgs = {
    id: Scalars['ID']['input'];
};
export type MutationTransferBetweenAccountsArgs = {
    input: TransferInput;
};
export type MutationUnlinkTelegramFromUserArgs = {
    telegramUserId: Scalars['ID']['input'];
};
export type MutationUpdateAccountArgs = {
    id: Scalars['ID']['input'];
    input: UpdateAccountInput;
};
export type MutationUpdateBorrowerArgs = {
    id: Scalars['ID']['input'];
    input: UpdateBorrowerInput;
};
export type MutationUpdateDocumentPhotoArgs = {
    id: Scalars['ID']['input'];
    input: UpdateDocumentInput;
};
export type MutationUpdateEmployeeArgs = {
    id: Scalars['ID']['input'];
    input: UpdateEmployeeInput;
};
export type MutationUpdateLeadPaymentReceivedArgs = {
    id: Scalars['ID']['input'];
    input: UpdateLeadPaymentReceivedInput;
};
export type MutationUpdateLoanArgs = {
    id: Scalars['ID']['input'];
    input: UpdateLoanInput;
};
export type MutationUpdateLoanExtendedArgs = {
    id: Scalars['ID']['input'];
    input: UpdateLoanExtendedInput;
};
export type MutationUpdateLoanPaymentArgs = {
    id: Scalars['ID']['input'];
    input: UpdateLoanPaymentInput;
};
export type MutationUpdateLoantypeArgs = {
    id: Scalars['ID']['input'];
    input: UpdateLoantypeInput;
};
export type MutationUpdatePersonalDataArgs = {
    fullName: Scalars['String']['input'];
    id: Scalars['ID']['input'];
};
export type MutationUpdatePhoneArgs = {
    input: UpdatePhoneInput;
};
export type MutationUpdatePortfolioCleanupArgs = {
    id: Scalars['ID']['input'];
    input: UpdatePortfolioCleanupInput;
};
export type MutationUpdateReportConfigArgs = {
    id: Scalars['ID']['input'];
    input: UpdateReportConfigInput;
};
export type MutationUpdateRouteArgs = {
    id: Scalars['ID']['input'];
    input: UpdateRouteInput;
};
export type MutationUpdateTelegramUserArgs = {
    id: Scalars['ID']['input'];
    input: UpdateTelegramUserInput;
};
export type MutationUpdateTransactionArgs = {
    id: Scalars['ID']['input'];
    input: UpdateTransactionInput;
};
export type MutationUpdateUserArgs = {
    id: Scalars['ID']['input'];
    input: UpdateUserInput;
};
export type MutationUploadDocumentPhotoArgs = {
    input: UploadDocumentInput;
};
export type NoPaymentPeriod = {
    __typename?: 'NoPaymentPeriod';
    endDate: Scalars['DateTime']['output'];
    endDateFormatted: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    startDate: Scalars['DateTime']['output'];
    startDateFormatted: Scalars['String']['output'];
    weekCount: Scalars['Int']['output'];
};
export declare enum NotificationStatus {
    Failed = "FAILED",
    Pending = "PENDING",
    Retry = "RETRY",
    Sent = "SENT"
}
export type PdfGenerationResult = {
    __typename?: 'PDFGenerationResult';
    base64?: Maybe<Scalars['String']['output']>;
    error?: Maybe<Scalars['String']['output']>;
    filename: Scalars['String']['output'];
    generatedAt: Scalars['DateTime']['output'];
    success: Scalars['Boolean']['output'];
    url?: Maybe<Scalars['String']['output']>;
};
export type PageInfo = {
    __typename?: 'PageInfo';
    endCursor?: Maybe<Scalars['String']['output']>;
    hasNextPage: Scalars['Boolean']['output'];
    hasPreviousPage: Scalars['Boolean']['output'];
    startCursor?: Maybe<Scalars['String']['output']>;
};
export type PaymentForLeadInput = {
    amount: Scalars['Decimal']['input'];
    comission?: InputMaybe<Scalars['Decimal']['input']>;
    loanId: Scalars['ID']['input'];
    paymentMethod: PaymentMethod;
};
export declare enum PaymentMethod {
    Cash = "CASH",
    MoneyTransfer = "MONEY_TRANSFER"
}
export type PerformanceMetrics = {
    __typename?: 'PerformanceMetrics';
    activeLoansCount: Scalars['Int']['output'];
    averageTicket: Scalars['Decimal']['output'];
    finishedLoansCount: Scalars['Int']['output'];
    recoveryRate: Scalars['Decimal']['output'];
};
export type PeriodComparison = {
    __typename?: 'PeriodComparison';
    balanceChange: Scalars['Int']['output'];
    cvChange: Scalars['Int']['output'];
    previousBalance: Scalars['Int']['output'];
    previousClientesActivos: Scalars['Int']['output'];
    previousClientesEnCV: Scalars['Int']['output'];
};
export declare enum PeriodType {
    Monthly = "MONTHLY",
    Weekly = "WEEKLY"
}
export type PersonalData = {
    __typename?: 'PersonalData';
    addresses: Array<Address>;
    birthDate?: Maybe<Scalars['DateTime']['output']>;
    borrower?: Maybe<Borrower>;
    clientCode: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    employee?: Maybe<Employee>;
    fullName: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    phones: Array<Phone>;
    updatedAt: Scalars['DateTime']['output'];
};
export type Phone = {
    __typename?: 'Phone';
    id: Scalars['ID']['output'];
    number: Scalars['String']['output'];
    personalData: PersonalData;
};
export type PortfolioCleanup = {
    __typename?: 'PortfolioCleanup';
    cleanupDate: Scalars['DateTime']['output'];
    createdAt: Scalars['DateTime']['output'];
    description?: Maybe<Scalars['String']['output']>;
    excludedAmount: Scalars['Decimal']['output'];
    excludedLoansCount: Scalars['Int']['output'];
    executedBy: User;
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    route?: Maybe<Route>;
    toDate?: Maybe<Scalars['DateTime']['output']>;
};
export type PortfolioFiltersInput = {
    loantypeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    locationIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    routeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
};
export type PortfolioReport = {
    __typename?: 'PortfolioReport';
    byLocation: Array<LocationBreakdown>;
    month?: Maybe<Scalars['Int']['output']>;
    periodType: PeriodType;
    renovationKPIs: RenovationKpIs;
    reportDate: Scalars['DateTime']['output'];
    summary: PortfolioSummary;
    weekNumber?: Maybe<Scalars['Int']['output']>;
    weeklyData: Array<WeeklyPortfolioData>;
    year: Scalars['Int']['output'];
};
export type PortfolioSummary = {
    __typename?: 'PortfolioSummary';
    clientBalance: ClientBalanceData;
    clientesAlCorriente: Scalars['Int']['output'];
    clientesEnCV: Scalars['Int']['output'];
    comparison?: Maybe<PeriodComparison>;
    /** Promedio de clientes en CV de las semanas completadas (solo para reportes mensuales) */
    promedioCV?: Maybe<Scalars['Int']['output']>;
    /** Número de semanas completadas usadas para calcular el promedio */
    semanasCompletadas?: Maybe<Scalars['Int']['output']>;
    totalClientesActivos: Scalars['Int']['output'];
    /** Total de semanas en el período */
    totalSemanas?: Maybe<Scalars['Int']['output']>;
};
export type Query = {
    __typename?: 'Query';
    account?: Maybe<Account>;
    accounts: Array<Account>;
    activeClientsWithCVStatus: Array<ActiveClientStatus>;
    badDebtByMonth: Array<BadDebtData>;
    badDebtSummary: BadDebtSummary;
    checkExistingLeader?: Maybe<ExistingLeaderInfo>;
    currentActiveWeek: WeekRange;
    currentWeek: WeekInfo;
    deadDebtLoans: DeadDebtQueryResult;
    deadDebtMonthlySummary: DeadDebtMonthlySummaryResult;
    deadDebtSummaryByLocality: Array<DeadDebtSummaryByLocality>;
    documentNotificationLogs: Array<DocumentNotificationLog>;
    documentPhoto?: Maybe<DocumentPhoto>;
    documentPhotos: Array<DocumentPhoto>;
    documentsWithErrors: Array<DocumentPhoto>;
    documentsWithNotificationStatus: Array<DocumentWithNotificationStatus>;
    employee?: Maybe<Employee>;
    employees: Array<Employee>;
    financialReport: FinancialReport;
    getBankIncomeTransactions: BankIncomeTransactionsResponse;
    getClientHistory: ClientHistoryData;
    getFinancialReportAnnual: AnnualFinancialReport;
    leadPaymentReceivedByLeadAndDate?: Maybe<LeadPaymentReceived>;
    loan?: Maybe<Loan>;
    loanPayments: Array<LoanPayment>;
    loanPaymentsByLeadAndDate: Array<LoanPayment>;
    loans: LoanConnection;
    loansByWeekAndLocation: Array<Loan>;
    loansForBadDebt: Array<Loan>;
    loantype?: Maybe<Loantype>;
    loantypes: Array<Loantype>;
    localityClients: Array<LocalityClientDetail>;
    locations: Array<Location>;
    locationsCreatedInPeriod: Array<Location>;
    me?: Maybe<User>;
    municipalities: Array<Municipality>;
    portfolioByLocality: LocalityReport;
    portfolioCleanups: Array<PortfolioCleanup>;
    portfolioReportMonthly: PortfolioReport;
    portfolioReportWeekly: PortfolioReport;
    previewPortfolioCleanup: CleanupPreview;
    recoveredDeadDebt: RecoveredDeadDebtResult;
    reportConfig?: Maybe<ReportConfig>;
    reportConfigs: Array<ReportConfig>;
    reportExecutionLogs: Array<ReportExecutionLog>;
    route?: Maybe<Route>;
    routes: Array<Route>;
    routesWithStats: Array<RouteWithStats>;
    searchBorrowers: Array<BorrowerSearchResult>;
    searchClients: Array<ClientSearchResult>;
    searchPersonalData: Array<PersonalData>;
    telegramUser?: Maybe<TelegramUser>;
    telegramUserByChatId?: Maybe<TelegramUser>;
    telegramUserStats: TelegramUserStats;
    telegramUsers: Array<TelegramUser>;
    transactions: TransactionConnection;
    user?: Maybe<User>;
    users: Array<User>;
};
export type QueryAccountArgs = {
    id: Scalars['ID']['input'];
};
export type QueryAccountsArgs = {
    routeId?: InputMaybe<Scalars['ID']['input']>;
    type?: InputMaybe<AccountType>;
};
export type QueryActiveClientsWithCvStatusArgs = {
    filters?: InputMaybe<PortfolioFiltersInput>;
};
export type QueryBadDebtByMonthArgs = {
    month: Scalars['Int']['input'];
    year: Scalars['Int']['input'];
};
export type QueryCheckExistingLeaderArgs = {
    locationId: Scalars['ID']['input'];
};
export type QueryDeadDebtLoansArgs = {
    badDebtStatus?: InputMaybe<DeadDebtStatus>;
    fromDate?: InputMaybe<Scalars['DateTime']['input']>;
    localities?: InputMaybe<Array<Scalars['String']['input']>>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
    toDate?: InputMaybe<Scalars['DateTime']['input']>;
    weeksSinceLoanMin?: InputMaybe<Scalars['Int']['input']>;
    weeksWithoutPaymentMin?: InputMaybe<Scalars['Int']['input']>;
};
export type QueryDeadDebtMonthlySummaryArgs = {
    badDebtStatus?: InputMaybe<DeadDebtStatus>;
    fromDate?: InputMaybe<Scalars['DateTime']['input']>;
    localities?: InputMaybe<Array<Scalars['String']['input']>>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
    toDate?: InputMaybe<Scalars['DateTime']['input']>;
    weeksSinceLoanMin?: InputMaybe<Scalars['Int']['input']>;
    weeksWithoutPaymentMin?: InputMaybe<Scalars['Int']['input']>;
    year: Scalars['Int']['input'];
};
export type QueryDeadDebtSummaryByLocalityArgs = {
    badDebtStatus?: InputMaybe<DeadDebtStatus>;
    localities?: InputMaybe<Array<Scalars['String']['input']>>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
    weeksSinceLoanMin?: InputMaybe<Scalars['Int']['input']>;
    weeksWithoutPaymentMin?: InputMaybe<Scalars['Int']['input']>;
};
export type QueryDocumentNotificationLogsArgs = {
    fromDate?: InputMaybe<Scalars['DateTime']['input']>;
    issueType?: InputMaybe<IssueType>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
    status?: InputMaybe<NotificationStatus>;
    toDate?: InputMaybe<Scalars['DateTime']['input']>;
};
export type QueryDocumentPhotoArgs = {
    id: Scalars['ID']['input'];
};
export type QueryDocumentPhotosArgs = {
    documentType?: InputMaybe<DocumentType>;
    hasErrors?: InputMaybe<Scalars['Boolean']['input']>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    loanId?: InputMaybe<Scalars['ID']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    personalDataId?: InputMaybe<Scalars['ID']['input']>;
};
export type QueryDocumentsWithErrorsArgs = {
    routeId?: InputMaybe<Scalars['ID']['input']>;
};
export type QueryDocumentsWithNotificationStatusArgs = {
    hasErrors?: InputMaybe<Scalars['Boolean']['input']>;
    hasMissing?: InputMaybe<Scalars['Boolean']['input']>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
};
export type QueryEmployeeArgs = {
    id: Scalars['ID']['input'];
};
export type QueryEmployeesArgs = {
    routeId?: InputMaybe<Scalars['ID']['input']>;
    type?: InputMaybe<EmployeeType>;
};
export type QueryFinancialReportArgs = {
    month: Scalars['Int']['input'];
    routeIds: Array<Scalars['ID']['input']>;
    year: Scalars['Int']['input'];
};
export type QueryGetBankIncomeTransactionsArgs = {
    endDate: Scalars['String']['input'];
    onlyAbonos?: InputMaybe<Scalars['Boolean']['input']>;
    routeIds: Array<Scalars['ID']['input']>;
    startDate: Scalars['String']['input'];
};
export type QueryGetClientHistoryArgs = {
    clientId: Scalars['ID']['input'];
    locationId?: InputMaybe<Scalars['ID']['input']>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
};
export type QueryGetFinancialReportAnnualArgs = {
    routeIds: Array<Scalars['ID']['input']>;
    year: Scalars['Int']['input'];
};
export type QueryLeadPaymentReceivedByLeadAndDateArgs = {
    endDate: Scalars['DateTime']['input'];
    leadId: Scalars['ID']['input'];
    startDate: Scalars['DateTime']['input'];
};
export type QueryLoanArgs = {
    id: Scalars['ID']['input'];
};
export type QueryLoanPaymentsArgs = {
    limit?: InputMaybe<Scalars['Int']['input']>;
    loanId: Scalars['ID']['input'];
    offset?: InputMaybe<Scalars['Int']['input']>;
};
export type QueryLoanPaymentsByLeadAndDateArgs = {
    endDate: Scalars['DateTime']['input'];
    leadId: Scalars['ID']['input'];
    startDate: Scalars['DateTime']['input'];
};
export type QueryLoansArgs = {
    borrowerId?: InputMaybe<Scalars['ID']['input']>;
    fromDate?: InputMaybe<Scalars['DateTime']['input']>;
    leadId?: InputMaybe<Scalars['ID']['input']>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    locationId?: InputMaybe<Scalars['ID']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
    status?: InputMaybe<LoanStatus>;
    toDate?: InputMaybe<Scalars['DateTime']['input']>;
};
export type QueryLoansByWeekAndLocationArgs = {
    limit?: InputMaybe<Scalars['Int']['input']>;
    locationId?: InputMaybe<Scalars['ID']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    weekNumber: Scalars['Int']['input'];
    year: Scalars['Int']['input'];
};
export type QueryLoansForBadDebtArgs = {
    routeId?: InputMaybe<Scalars['ID']['input']>;
};
export type QueryLoantypeArgs = {
    id: Scalars['ID']['input'];
};
export type QueryLoantypesArgs = {
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
};
export type QueryLocalityClientsArgs = {
    category?: InputMaybe<ClientCategory>;
    localityId: Scalars['ID']['input'];
    month: Scalars['Int']['input'];
    weekNumber?: InputMaybe<Scalars['Int']['input']>;
    year: Scalars['Int']['input'];
};
export type QueryLocationsArgs = {
    routeId?: InputMaybe<Scalars['ID']['input']>;
};
export type QueryLocationsCreatedInPeriodArgs = {
    fromDate: Scalars['DateTime']['input'];
    routeId?: InputMaybe<Scalars['ID']['input']>;
    toDate: Scalars['DateTime']['input'];
};
export type QueryPortfolioByLocalityArgs = {
    filters?: InputMaybe<PortfolioFiltersInput>;
    month: Scalars['Int']['input'];
    year: Scalars['Int']['input'];
};
export type QueryPortfolioCleanupsArgs = {
    limit?: InputMaybe<Scalars['Int']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
};
export type QueryPortfolioReportMonthlyArgs = {
    filters?: InputMaybe<PortfolioFiltersInput>;
    month: Scalars['Int']['input'];
    year: Scalars['Int']['input'];
};
export type QueryPortfolioReportWeeklyArgs = {
    filters?: InputMaybe<PortfolioFiltersInput>;
    weekNumber: Scalars['Int']['input'];
    year: Scalars['Int']['input'];
};
export type QueryPreviewPortfolioCleanupArgs = {
    maxSignDate: Scalars['DateTime']['input'];
    routeId?: InputMaybe<Scalars['ID']['input']>;
};
export type QueryRecoveredDeadDebtArgs = {
    month: Scalars['Int']['input'];
    routeId?: InputMaybe<Scalars['ID']['input']>;
    year: Scalars['Int']['input'];
};
export type QueryReportConfigArgs = {
    id: Scalars['ID']['input'];
};
export type QueryReportConfigsArgs = {
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
};
export type QueryReportExecutionLogsArgs = {
    fromDate?: InputMaybe<Scalars['DateTime']['input']>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    reportConfigId?: InputMaybe<Scalars['ID']['input']>;
    status?: InputMaybe<Scalars['String']['input']>;
    toDate?: InputMaybe<Scalars['DateTime']['input']>;
};
export type QueryRouteArgs = {
    id: Scalars['ID']['input'];
};
export type QueryRoutesWithStatsArgs = {
    month: Scalars['Int']['input'];
    year: Scalars['Int']['input'];
};
export type QuerySearchBorrowersArgs = {
    leadId?: InputMaybe<Scalars['ID']['input']>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    locationId?: InputMaybe<Scalars['ID']['input']>;
    searchTerm: Scalars['String']['input'];
};
export type QuerySearchClientsArgs = {
    limit?: InputMaybe<Scalars['Int']['input']>;
    locationId?: InputMaybe<Scalars['ID']['input']>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
    searchTerm: Scalars['String']['input'];
};
export type QuerySearchPersonalDataArgs = {
    excludeBorrowerId?: InputMaybe<Scalars['ID']['input']>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    locationId?: InputMaybe<Scalars['ID']['input']>;
    searchTerm: Scalars['String']['input'];
};
export type QueryTelegramUserArgs = {
    id: Scalars['ID']['input'];
};
export type QueryTelegramUserByChatIdArgs = {
    chatId: Scalars['String']['input'];
};
export type QueryTelegramUsersArgs = {
    filters?: InputMaybe<TelegramUserFiltersInput>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
};
export type QueryTransactionsArgs = {
    accountId?: InputMaybe<Scalars['ID']['input']>;
    fromDate?: InputMaybe<Scalars['DateTime']['input']>;
    limit?: InputMaybe<Scalars['Int']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    routeId?: InputMaybe<Scalars['ID']['input']>;
    toDate?: InputMaybe<Scalars['DateTime']['input']>;
    type?: InputMaybe<TransactionType>;
};
export type QueryUserArgs = {
    id: Scalars['ID']['input'];
};
export type QueryUsersArgs = {
    limit?: InputMaybe<Scalars['Int']['input']>;
    offset?: InputMaybe<Scalars['Int']['input']>;
    role?: InputMaybe<UserRole>;
};
export type RecoveredDeadDebtPayment = {
    __typename?: 'RecoveredDeadDebtPayment';
    amount: Scalars['Decimal']['output'];
    badDebtDate: Scalars['DateTime']['output'];
    clientCode: Scalars['String']['output'];
    clientName: Scalars['String']['output'];
    id: Scalars['ID']['output'];
    loanId: Scalars['ID']['output'];
    locality: Scalars['String']['output'];
    pendingAmount: Scalars['Decimal']['output'];
    receivedAt: Scalars['DateTime']['output'];
    routeName: Scalars['String']['output'];
};
export type RecoveredDeadDebtResult = {
    __typename?: 'RecoveredDeadDebtResult';
    month: Scalars['Int']['output'];
    payments: Array<RecoveredDeadDebtPayment>;
    summary: RecoveredDeadDebtSummary;
    year: Scalars['Int']['output'];
};
export type RecoveredDeadDebtSummary = {
    __typename?: 'RecoveredDeadDebtSummary';
    clientsCount: Scalars['Int']['output'];
    loansCount: Scalars['Int']['output'];
    paymentsCount: Scalars['Int']['output'];
    totalRecovered: Scalars['Decimal']['output'];
};
export type RenewLoanInput = {
    amountGived: Scalars['Decimal']['input'];
    loantypeId: Scalars['ID']['input'];
    requestedAmount: Scalars['Decimal']['input'];
    signDate: Scalars['DateTime']['input'];
};
export type RenovationKpIs = {
    __typename?: 'RenovationKPIs';
    tasaRenovacion: Scalars['Decimal']['output'];
    tendencia: Trend;
    totalCierresSinRenovar: Scalars['Int']['output'];
    totalRenovaciones: Scalars['Int']['output'];
};
export type ReportConfig = {
    __typename?: 'ReportConfig';
    createdAt: Scalars['DateTime']['output'];
    executionLogs: Array<ReportExecutionLog>;
    id: Scalars['ID']['output'];
    isActive: Scalars['Boolean']['output'];
    name: Scalars['String']['output'];
    reportType: Scalars['String']['output'];
    routes: Array<Route>;
    schedule?: Maybe<ReportSchedule>;
    telegramRecipients: Array<TelegramUser>;
    updatedAt: Scalars['DateTime']['output'];
};
export type ReportExecutionLog = {
    __typename?: 'ReportExecutionLog';
    createdAt: Scalars['DateTime']['output'];
    cronExpression?: Maybe<Scalars['String']['output']>;
    duration?: Maybe<Scalars['Int']['output']>;
    endTime?: Maybe<Scalars['DateTime']['output']>;
    errorDetails?: Maybe<Scalars['String']['output']>;
    executionType: Scalars['String']['output'];
    failedDeliveries?: Maybe<Scalars['Int']['output']>;
    id: Scalars['ID']['output'];
    message?: Maybe<Scalars['String']['output']>;
    recipientsCount?: Maybe<Scalars['Int']['output']>;
    reportConfig: ReportConfig;
    startTime: Scalars['DateTime']['output'];
    status: Scalars['String']['output'];
    successfulDeliveries?: Maybe<Scalars['Int']['output']>;
    timezone?: Maybe<Scalars['String']['output']>;
};
export type ReportExecutionResult = {
    __typename?: 'ReportExecutionResult';
    errors?: Maybe<Array<Scalars['String']['output']>>;
    message: Scalars['String']['output'];
    recipientsNotified: Scalars['Int']['output'];
    success: Scalars['Boolean']['output'];
};
export type ReportSchedule = {
    __typename?: 'ReportSchedule';
    days: Array<Scalars['String']['output']>;
    hour: Scalars['String']['output'];
    timezone: Scalars['String']['output'];
};
export type ReportScheduleInput = {
    days: Array<Scalars['String']['input']>;
    hour: Scalars['String']['input'];
    timezone?: InputMaybe<Scalars['String']['input']>;
};
export declare enum ReportType {
    CreditosConErrores = "CREDITOS_CON_ERRORES",
    NotificacionTiempoReal = "NOTIFICACION_TIEMPO_REAL"
}
export type Route = {
    __typename?: 'Route';
    accounts: Array<Account>;
    createdAt: Scalars['DateTime']['output'];
    employees: Array<Employee>;
    id: Scalars['ID']['output'];
    locations: Array<Location>;
    name: Scalars['String']['output'];
    transactions: Array<Transaction>;
    updatedAt: Scalars['DateTime']['output'];
};
export type RouteAmountInput = {
    amount: Scalars['Decimal']['input'];
    routeId: Scalars['ID']['input'];
};
export type RouteInfo = {
    __typename?: 'RouteInfo';
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
};
/** Route with calculated statistics for administration */
export type RouteWithStats = {
    __typename?: 'RouteWithStats';
    alCorriente: Scalars['Int']['output'];
    employees: Array<EmployeeWithStats>;
    enCV: Scalars['Int']['output'];
    routeId: Scalars['ID']['output'];
    routeName: Scalars['String']['output'];
    totalActivos: Scalars['Int']['output'];
};
export type SendDocumentNotificationInput = {
    customMessage?: InputMaybe<Scalars['String']['input']>;
    documentId: Scalars['ID']['input'];
    includePhoto?: InputMaybe<Scalars['Boolean']['input']>;
    recipientChatIds: Array<Scalars['String']['input']>;
};
export type SendNotificationResult = {
    __typename?: 'SendNotificationResult';
    message: Scalars['String']['output'];
    notificationId?: Maybe<Scalars['ID']['output']>;
    success: Scalars['Boolean']['output'];
    telegramResponse?: Maybe<Scalars['String']['output']>;
};
export type State = {
    __typename?: 'State';
    id: Scalars['ID']['output'];
    municipalities: Array<Municipality>;
    name: Scalars['String']['output'];
};
export type TelegramUser = {
    __typename?: 'TelegramUser';
    chatId: Scalars['String']['output'];
    createdAt: Scalars['DateTime']['output'];
    id: Scalars['ID']['output'];
    isActive: Scalars['Boolean']['output'];
    isInRecipientsList: Scalars['Boolean']['output'];
    lastActivity: Scalars['DateTime']['output'];
    name: Scalars['String']['output'];
    notes?: Maybe<Scalars['String']['output']>;
    platformUser?: Maybe<User>;
    registeredAt: Scalars['DateTime']['output'];
    reportConfigs: Array<ReportConfig>;
    reportsReceived: Scalars['Int']['output'];
    updatedAt: Scalars['DateTime']['output'];
    username?: Maybe<Scalars['String']['output']>;
};
export type TelegramUserFiltersInput = {
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
    isInRecipientsList?: InputMaybe<Scalars['Boolean']['input']>;
    isLinkedToUser?: InputMaybe<Scalars['Boolean']['input']>;
    searchTerm?: InputMaybe<Scalars['String']['input']>;
};
export type TelegramUserStats = {
    __typename?: 'TelegramUserStats';
    activeUsers: Scalars['Int']['output'];
    inRecipientsList: Scalars['Int']['output'];
    inactiveUsers: Scalars['Int']['output'];
    linkedToPlataform: Scalars['Int']['output'];
    totalUsers: Scalars['Int']['output'];
};
export type Transaction = {
    __typename?: 'Transaction';
    amount: Scalars['Decimal']['output'];
    createdAt: Scalars['DateTime']['output'];
    date: Scalars['DateTime']['output'];
    destinationAccount?: Maybe<Account>;
    expenseSource?: Maybe<Scalars['String']['output']>;
    id: Scalars['ID']['output'];
    incomeSource?: Maybe<Scalars['String']['output']>;
    lead?: Maybe<Employee>;
    loan?: Maybe<Loan>;
    loanPayment?: Maybe<LoanPayment>;
    profitAmount?: Maybe<Scalars['Decimal']['output']>;
    returnToCapital?: Maybe<Scalars['Decimal']['output']>;
    route?: Maybe<Route>;
    sourceAccount: Account;
    type: TransactionType;
    updatedAt: Scalars['DateTime']['output'];
};
export type TransactionConnection = {
    __typename?: 'TransactionConnection';
    edges: Array<TransactionEdge>;
    pageInfo: PageInfo;
    totalCount: Scalars['Int']['output'];
};
export type TransactionEdge = {
    __typename?: 'TransactionEdge';
    cursor: Scalars['String']['output'];
    node: Transaction;
};
export declare enum TransactionType {
    Expense = "EXPENSE",
    Income = "INCOME",
    Investment = "INVESTMENT",
    Transfer = "TRANSFER"
}
export type TransferInput = {
    amount: Scalars['Decimal']['input'];
    description?: InputMaybe<Scalars['String']['input']>;
    destinationAccountId: Scalars['ID']['input'];
    sourceAccountId: Scalars['ID']['input'];
};
export declare enum Trend {
    Down = "DOWN",
    Stable = "STABLE",
    Up = "UP"
}
export type UpdateAccountInput = {
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
    name?: InputMaybe<Scalars['String']['input']>;
};
export type UpdateBorrowerInput = {
    personalData?: InputMaybe<UpdatePersonalDataInput>;
};
export type UpdateDocumentInput = {
    description?: InputMaybe<Scalars['String']['input']>;
    errorDescription?: InputMaybe<Scalars['String']['input']>;
    isError?: InputMaybe<Scalars['Boolean']['input']>;
    isMissing?: InputMaybe<Scalars['Boolean']['input']>;
    title?: InputMaybe<Scalars['String']['input']>;
};
export type UpdateEmployeeInput = {
    routeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    type?: InputMaybe<EmployeeType>;
};
export type UpdateLeadPaymentReceivedInput = {
    bankPaidAmount?: InputMaybe<Scalars['Decimal']['input']>;
    cashPaidAmount?: InputMaybe<Scalars['Decimal']['input']>;
    expectedAmount?: InputMaybe<Scalars['Decimal']['input']>;
    falcoAmount?: InputMaybe<Scalars['Decimal']['input']>;
    paidAmount?: InputMaybe<Scalars['Decimal']['input']>;
    payments?: InputMaybe<Array<UpdatePaymentForLeadInput>>;
};
export type UpdateLoanExtendedInput = {
    borrowerName?: InputMaybe<Scalars['String']['input']>;
    borrowerPhone?: InputMaybe<Scalars['String']['input']>;
    collateralIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    collateralPhone?: InputMaybe<Scalars['String']['input']>;
    comissionAmount?: InputMaybe<Scalars['Decimal']['input']>;
    loantypeId?: InputMaybe<Scalars['ID']['input']>;
    newCollateral?: InputMaybe<CreatePersonalDataInput>;
    requestedAmount?: InputMaybe<Scalars['Decimal']['input']>;
};
export type UpdateLoanInput = {
    amountGived?: InputMaybe<Scalars['Decimal']['input']>;
    badDebtDate?: InputMaybe<Scalars['DateTime']['input']>;
    isDeceased?: InputMaybe<Scalars['Boolean']['input']>;
    leadId?: InputMaybe<Scalars['ID']['input']>;
    status?: InputMaybe<LoanStatus>;
};
export type UpdateLoanPaymentInput = {
    amount?: InputMaybe<Scalars['Decimal']['input']>;
    comission?: InputMaybe<Scalars['Decimal']['input']>;
    paymentMethod?: InputMaybe<PaymentMethod>;
};
export type UpdateLoantypeInput = {
    interestRate?: InputMaybe<Scalars['Decimal']['input']>;
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
    loanGrantedComission?: InputMaybe<Scalars['Decimal']['input']>;
    loanPaymentComission?: InputMaybe<Scalars['Decimal']['input']>;
    maxAmount?: InputMaybe<Scalars['Decimal']['input']>;
    maxTerm?: InputMaybe<Scalars['Int']['input']>;
    name?: InputMaybe<Scalars['String']['input']>;
    rate?: InputMaybe<Scalars['Decimal']['input']>;
    weekDuration?: InputMaybe<Scalars['Int']['input']>;
};
export type UpdatePaymentForLeadInput = {
    amount: Scalars['Decimal']['input'];
    comission?: InputMaybe<Scalars['Decimal']['input']>;
    isDeleted?: InputMaybe<Scalars['Boolean']['input']>;
    loanId: Scalars['ID']['input'];
    paymentId?: InputMaybe<Scalars['ID']['input']>;
    paymentMethod: PaymentMethod;
};
export type UpdatePersonalDataInput = {
    birthDate?: InputMaybe<Scalars['DateTime']['input']>;
    fullName?: InputMaybe<Scalars['String']['input']>;
};
export type UpdatePhoneInput = {
    number: Scalars['String']['input'];
    personalDataId: Scalars['ID']['input'];
    phoneId?: InputMaybe<Scalars['ID']['input']>;
};
export type UpdatePortfolioCleanupInput = {
    cleanupDate?: InputMaybe<Scalars['DateTime']['input']>;
    description?: InputMaybe<Scalars['String']['input']>;
    name?: InputMaybe<Scalars['String']['input']>;
};
export type UpdateReportConfigInput = {
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
    name?: InputMaybe<Scalars['String']['input']>;
    recipientIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    routeIds?: InputMaybe<Array<Scalars['ID']['input']>>;
    schedule?: InputMaybe<ReportScheduleInput>;
};
export type UpdateRouteInput = {
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
    name?: InputMaybe<Scalars['String']['input']>;
};
export type UpdateTelegramUserInput = {
    isActive?: InputMaybe<Scalars['Boolean']['input']>;
    isInRecipientsList?: InputMaybe<Scalars['Boolean']['input']>;
    notes?: InputMaybe<Scalars['String']['input']>;
};
export type UpdateTransactionInput = {
    amount?: InputMaybe<Scalars['Decimal']['input']>;
    description?: InputMaybe<Scalars['String']['input']>;
    expenseSource?: InputMaybe<Scalars['String']['input']>;
    incomeSource?: InputMaybe<Scalars['String']['input']>;
    sourceAccountId?: InputMaybe<Scalars['ID']['input']>;
};
export type UpdateUserInput = {
    email?: InputMaybe<Scalars['String']['input']>;
    employeeId?: InputMaybe<Scalars['ID']['input']>;
    name?: InputMaybe<Scalars['String']['input']>;
    password?: InputMaybe<Scalars['String']['input']>;
    role?: InputMaybe<UserRole>;
    telegramChatId?: InputMaybe<Scalars['String']['input']>;
};
export type UploadDocumentInput = {
    description?: InputMaybe<Scalars['String']['input']>;
    documentType: DocumentType;
    errorDescription?: InputMaybe<Scalars['String']['input']>;
    file: Scalars['Upload']['input'];
    isError?: InputMaybe<Scalars['Boolean']['input']>;
    isMissing?: InputMaybe<Scalars['Boolean']['input']>;
    loanId?: InputMaybe<Scalars['ID']['input']>;
    personalDataId?: InputMaybe<Scalars['ID']['input']>;
    title?: InputMaybe<Scalars['String']['input']>;
};
export type User = {
    __typename?: 'User';
    createdAt: Scalars['DateTime']['output'];
    email: Scalars['String']['output'];
    employee?: Maybe<Employee>;
    id: Scalars['ID']['output'];
    name: Scalars['String']['output'];
    role: UserRole;
    telegramUser?: Maybe<TelegramUser>;
};
export declare enum UserRole {
    Admin = "ADMIN",
    Captura = "CAPTURA",
    Normal = "NORMAL"
}
export type WeekInfo = {
    __typename?: 'WeekInfo';
    endDate: Scalars['DateTime']['output'];
    startDate: Scalars['DateTime']['output'];
    weekNumber: Scalars['Int']['output'];
    year: Scalars['Int']['output'];
};
export type WeekRange = {
    __typename?: 'WeekRange';
    end: Scalars['DateTime']['output'];
    start: Scalars['DateTime']['output'];
    weekNumber: Scalars['Int']['output'];
    year: Scalars['Int']['output'];
};
export type WeeklyData = {
    __typename?: 'WeeklyData';
    date: Scalars['DateTime']['output'];
    expectedPayments: Scalars['Decimal']['output'];
    loansGranted: Scalars['Int']['output'];
    paymentsCount: Scalars['Int']['output'];
    paymentsReceived: Scalars['Decimal']['output'];
    recoveryRate: Scalars['Decimal']['output'];
    week: Scalars['Int']['output'];
};
export type WeeklyPortfolioData = {
    __typename?: 'WeeklyPortfolioData';
    balance: Scalars['Int']['output'];
    clientesActivos: Scalars['Int']['output'];
    clientesEnCV: Scalars['Int']['output'];
    /** Si la semana ya está completada (pasó el domingo) */
    isCompleted: Scalars['Boolean']['output'];
    weekRange: WeekRange;
};
export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;
export type ResolverTypeWrapper<T> = Promise<T> | T;
export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
    resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = {}, TContext = {}, TArgs = {}> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;
export type ResolverFn<TResult, TParent, TContext, TArgs> = (parent: TParent, args: TArgs, context: TContext, info: GraphQLResolveInfo) => Promise<TResult> | TResult;
export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (parent: TParent, args: TArgs, context: TContext, info: GraphQLResolveInfo) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;
export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (parent: TParent, args: TArgs, context: TContext, info: GraphQLResolveInfo) => TResult | Promise<TResult>;
export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
    subscribe: SubscriptionSubscribeFn<{
        [key in TKey]: TResult;
    }, TParent, TContext, TArgs>;
    resolve?: SubscriptionResolveFn<TResult, {
        [key in TKey]: TResult;
    }, TContext, TArgs>;
}
export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
    subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
    resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}
export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> = SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs> | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;
export type SubscriptionResolver<TResult, TKey extends string, TParent = {}, TContext = {}, TArgs = {}> = ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>) | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;
export type TypeResolveFn<TTypes, TParent = {}, TContext = {}> = (parent: TParent, context: TContext, info: GraphQLResolveInfo) => Maybe<TTypes> | Promise<Maybe<TTypes>>;
export type IsTypeOfResolverFn<T = {}, TContext = {}> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;
export type NextResolverFn<T> = () => Promise<T>;
export type DirectiveResolverFn<TResult = {}, TParent = {}, TContext = {}, TArgs = {}> = (next: NextResolverFn<TResult>, parent: TParent, args: TArgs, context: TContext, info: GraphQLResolveInfo) => TResult | Promise<TResult>;
/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
    Account: ResolverTypeWrapper<Account>;
    AccountType: AccountType;
    ActiveClientStatus: ResolverTypeWrapper<ActiveClientStatus>;
    ActiveLoansBreakdown: ResolverTypeWrapper<ActiveLoansBreakdown>;
    Address: ResolverTypeWrapper<Address>;
    AnnualFinancialReport: ResolverTypeWrapper<AnnualFinancialReport>;
    AuthPayload: ResolverTypeWrapper<AuthPayload>;
    BadDebtData: ResolverTypeWrapper<BadDebtData>;
    BadDebtSummary: ResolverTypeWrapper<BadDebtSummary>;
    BankIncomeTransaction: ResolverTypeWrapper<BankIncomeTransaction>;
    BankIncomeTransactionsResponse: ResolverTypeWrapper<BankIncomeTransactionsResponse>;
    BatchTransferResult: ResolverTypeWrapper<BatchTransferResult>;
    Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
    Borrower: ResolverTypeWrapper<Borrower>;
    BorrowerSearchResult: ResolverTypeWrapper<BorrowerSearchResult>;
    CVStatus: CvStatus;
    CleanupLoanPreview: ResolverTypeWrapper<CleanupLoanPreview>;
    CleanupPreview: ResolverTypeWrapper<CleanupPreview>;
    ClientAddressInfo: ResolverTypeWrapper<ClientAddressInfo>;
    ClientBalanceData: ResolverTypeWrapper<ClientBalanceData>;
    ClientCategory: ClientCategory;
    ClientHistoryData: ResolverTypeWrapper<ClientHistoryData>;
    ClientInfo: ResolverTypeWrapper<ClientInfo>;
    ClientSearchResult: ResolverTypeWrapper<ClientSearchResult>;
    ClientSummary: ResolverTypeWrapper<ClientSummary>;
    CommissionPayment: ResolverTypeWrapper<CommissionPayment>;
    ComparisonData: ResolverTypeWrapper<ComparisonData>;
    CreateAccountInput: CreateAccountInput;
    CreateAddressInput: CreateAddressInput;
    CreateBorrowerInput: CreateBorrowerInput;
    CreateEmployeeInput: CreateEmployeeInput;
    CreateLeadPaymentReceivedInput: CreateLeadPaymentReceivedInput;
    CreateLoanInput: CreateLoanInput;
    CreateLoanPaymentInput: CreateLoanPaymentInput;
    CreateLoansInBatchInput: CreateLoansInBatchInput;
    CreateLoantypeInput: CreateLoantypeInput;
    CreateLocationInput: CreateLocationInput;
    CreateNewLeaderInput: CreateNewLeaderInput;
    CreateNewLeaderResult: ResolverTypeWrapper<CreateNewLeaderResult>;
    CreatePersonalDataInput: CreatePersonalDataInput;
    CreatePhoneInput: CreatePhoneInput;
    CreatePortfolioCleanupInput: CreatePortfolioCleanupInput;
    CreateReportConfigInput: CreateReportConfigInput;
    CreateRouteInput: CreateRouteInput;
    CreateSingleLoanInput: CreateSingleLoanInput;
    CreateTransactionInput: CreateTransactionInput;
    CreateUserInput: CreateUserInput;
    DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
    DeadDebtBorrower: ResolverTypeWrapper<DeadDebtBorrower>;
    DeadDebtCriteria: ResolverTypeWrapper<DeadDebtCriteria>;
    DeadDebtLead: ResolverTypeWrapper<DeadDebtLead>;
    DeadDebtLoan: ResolverTypeWrapper<DeadDebtLoan>;
    DeadDebtMonthSummary: ResolverTypeWrapper<DeadDebtMonthSummary>;
    DeadDebtMonthlySummaryResult: ResolverTypeWrapper<DeadDebtMonthlySummaryResult>;
    DeadDebtPayment: ResolverTypeWrapper<DeadDebtPayment>;
    DeadDebtQueryResult: ResolverTypeWrapper<DeadDebtQueryResult>;
    DeadDebtStatus: DeadDebtStatus;
    DeadDebtSummaryByLocality: ResolverTypeWrapper<DeadDebtSummaryByLocality>;
    DeadDebtTotals: ResolverTypeWrapper<DeadDebtTotals>;
    Decimal: ResolverTypeWrapper<Scalars['Decimal']['output']>;
    DistributeMoneyInput: DistributeMoneyInput;
    DistributionMode: DistributionMode;
    DocumentNotificationLog: ResolverTypeWrapper<DocumentNotificationLog>;
    DocumentPhoto: ResolverTypeWrapper<DocumentPhoto>;
    DocumentType: DocumentType;
    DocumentWithNotificationStatus: ResolverTypeWrapper<DocumentWithNotificationStatus>;
    DrainRoutesInput: DrainRoutesInput;
    Employee: ResolverTypeWrapper<Employee>;
    EmployeeType: EmployeeType;
    EmployeeWithStats: ResolverTypeWrapper<EmployeeWithStats>;
    EvaluationPeriod: ResolverTypeWrapper<EvaluationPeriod>;
    ExistingLeaderInfo: ResolverTypeWrapper<ExistingLeaderInfo>;
    FinancialReport: ResolverTypeWrapper<FinancialReport>;
    FinancialSummary: ResolverTypeWrapper<FinancialSummary>;
    FirstPaymentInput: FirstPaymentInput;
    Float: ResolverTypeWrapper<Scalars['Float']['output']>;
    ID: ResolverTypeWrapper<Scalars['ID']['output']>;
    Int: ResolverTypeWrapper<Scalars['Int']['output']>;
    IssueType: IssueType;
    JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
    LeadPaymentReceived: ResolverTypeWrapper<LeadPaymentReceived>;
    LeaderInfo: ResolverTypeWrapper<LeaderInfo>;
    LinkTelegramToUserInput: LinkTelegramToUserInput;
    Loan: ResolverTypeWrapper<Loan>;
    LoanConnection: ResolverTypeWrapper<LoanConnection>;
    LoanEdge: ResolverTypeWrapper<LoanEdge>;
    LoanHistoryDetail: ResolverTypeWrapper<LoanHistoryDetail>;
    LoanPayment: ResolverTypeWrapper<LoanPayment>;
    LoanPaymentDetail: ResolverTypeWrapper<LoanPaymentDetail>;
    LoanStatus: LoanStatus;
    Loantype: ResolverTypeWrapper<Loantype>;
    LocalityBreakdownDetail: ResolverTypeWrapper<LocalityBreakdownDetail>;
    LocalityClientDetail: ResolverTypeWrapper<LocalityClientDetail>;
    LocalityReport: ResolverTypeWrapper<LocalityReport>;
    LocalitySummary: ResolverTypeWrapper<LocalitySummary>;
    LocalityWeekData: ResolverTypeWrapper<LocalityWeekData>;
    Location: ResolverTypeWrapper<Location>;
    LocationBreakdown: ResolverTypeWrapper<LocationBreakdown>;
    MarkDeadDebtResult: ResolverTypeWrapper<MarkDeadDebtResult>;
    MarkDocumentAsMissingInput: MarkDocumentAsMissingInput;
    MonthInfo: ResolverTypeWrapper<MonthInfo>;
    MonthlyFinancialData: ResolverTypeWrapper<MonthlyFinancialData>;
    Municipality: ResolverTypeWrapper<Municipality>;
    Mutation: ResolverTypeWrapper<{}>;
    NoPaymentPeriod: ResolverTypeWrapper<NoPaymentPeriod>;
    NotificationStatus: NotificationStatus;
    PDFGenerationResult: ResolverTypeWrapper<PdfGenerationResult>;
    PageInfo: ResolverTypeWrapper<PageInfo>;
    PaymentForLeadInput: PaymentForLeadInput;
    PaymentMethod: PaymentMethod;
    PerformanceMetrics: ResolverTypeWrapper<PerformanceMetrics>;
    PeriodComparison: ResolverTypeWrapper<PeriodComparison>;
    PeriodType: PeriodType;
    PersonalData: ResolverTypeWrapper<PersonalData>;
    Phone: ResolverTypeWrapper<Phone>;
    PortfolioCleanup: ResolverTypeWrapper<PortfolioCleanup>;
    PortfolioFiltersInput: PortfolioFiltersInput;
    PortfolioReport: ResolverTypeWrapper<PortfolioReport>;
    PortfolioSummary: ResolverTypeWrapper<PortfolioSummary>;
    Query: ResolverTypeWrapper<{}>;
    RecoveredDeadDebtPayment: ResolverTypeWrapper<RecoveredDeadDebtPayment>;
    RecoveredDeadDebtResult: ResolverTypeWrapper<RecoveredDeadDebtResult>;
    RecoveredDeadDebtSummary: ResolverTypeWrapper<RecoveredDeadDebtSummary>;
    RenewLoanInput: RenewLoanInput;
    RenovationKPIs: ResolverTypeWrapper<RenovationKpIs>;
    ReportConfig: ResolverTypeWrapper<ReportConfig>;
    ReportExecutionLog: ResolverTypeWrapper<ReportExecutionLog>;
    ReportExecutionResult: ResolverTypeWrapper<ReportExecutionResult>;
    ReportSchedule: ResolverTypeWrapper<ReportSchedule>;
    ReportScheduleInput: ReportScheduleInput;
    ReportType: ReportType;
    Route: ResolverTypeWrapper<Route>;
    RouteAmountInput: RouteAmountInput;
    RouteInfo: ResolverTypeWrapper<RouteInfo>;
    RouteWithStats: ResolverTypeWrapper<RouteWithStats>;
    SendDocumentNotificationInput: SendDocumentNotificationInput;
    SendNotificationResult: ResolverTypeWrapper<SendNotificationResult>;
    State: ResolverTypeWrapper<State>;
    String: ResolverTypeWrapper<Scalars['String']['output']>;
    TelegramUser: ResolverTypeWrapper<TelegramUser>;
    TelegramUserFiltersInput: TelegramUserFiltersInput;
    TelegramUserStats: ResolverTypeWrapper<TelegramUserStats>;
    Transaction: ResolverTypeWrapper<Transaction>;
    TransactionConnection: ResolverTypeWrapper<TransactionConnection>;
    TransactionEdge: ResolverTypeWrapper<TransactionEdge>;
    TransactionType: TransactionType;
    TransferInput: TransferInput;
    Trend: Trend;
    UpdateAccountInput: UpdateAccountInput;
    UpdateBorrowerInput: UpdateBorrowerInput;
    UpdateDocumentInput: UpdateDocumentInput;
    UpdateEmployeeInput: UpdateEmployeeInput;
    UpdateLeadPaymentReceivedInput: UpdateLeadPaymentReceivedInput;
    UpdateLoanExtendedInput: UpdateLoanExtendedInput;
    UpdateLoanInput: UpdateLoanInput;
    UpdateLoanPaymentInput: UpdateLoanPaymentInput;
    UpdateLoantypeInput: UpdateLoantypeInput;
    UpdatePaymentForLeadInput: UpdatePaymentForLeadInput;
    UpdatePersonalDataInput: UpdatePersonalDataInput;
    UpdatePhoneInput: UpdatePhoneInput;
    UpdatePortfolioCleanupInput: UpdatePortfolioCleanupInput;
    UpdateReportConfigInput: UpdateReportConfigInput;
    UpdateRouteInput: UpdateRouteInput;
    UpdateTelegramUserInput: UpdateTelegramUserInput;
    UpdateTransactionInput: UpdateTransactionInput;
    UpdateUserInput: UpdateUserInput;
    Upload: ResolverTypeWrapper<Scalars['Upload']['output']>;
    UploadDocumentInput: UploadDocumentInput;
    User: ResolverTypeWrapper<User>;
    UserRole: UserRole;
    WeekInfo: ResolverTypeWrapper<WeekInfo>;
    WeekRange: ResolverTypeWrapper<WeekRange>;
    WeeklyData: ResolverTypeWrapper<WeeklyData>;
    WeeklyPortfolioData: ResolverTypeWrapper<WeeklyPortfolioData>;
}>;
/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
    Account: Account;
    ActiveClientStatus: ActiveClientStatus;
    ActiveLoansBreakdown: ActiveLoansBreakdown;
    Address: Address;
    AnnualFinancialReport: AnnualFinancialReport;
    AuthPayload: AuthPayload;
    BadDebtData: BadDebtData;
    BadDebtSummary: BadDebtSummary;
    BankIncomeTransaction: BankIncomeTransaction;
    BankIncomeTransactionsResponse: BankIncomeTransactionsResponse;
    BatchTransferResult: BatchTransferResult;
    Boolean: Scalars['Boolean']['output'];
    Borrower: Borrower;
    BorrowerSearchResult: BorrowerSearchResult;
    CleanupLoanPreview: CleanupLoanPreview;
    CleanupPreview: CleanupPreview;
    ClientAddressInfo: ClientAddressInfo;
    ClientBalanceData: ClientBalanceData;
    ClientHistoryData: ClientHistoryData;
    ClientInfo: ClientInfo;
    ClientSearchResult: ClientSearchResult;
    ClientSummary: ClientSummary;
    CommissionPayment: CommissionPayment;
    ComparisonData: ComparisonData;
    CreateAccountInput: CreateAccountInput;
    CreateAddressInput: CreateAddressInput;
    CreateBorrowerInput: CreateBorrowerInput;
    CreateEmployeeInput: CreateEmployeeInput;
    CreateLeadPaymentReceivedInput: CreateLeadPaymentReceivedInput;
    CreateLoanInput: CreateLoanInput;
    CreateLoanPaymentInput: CreateLoanPaymentInput;
    CreateLoansInBatchInput: CreateLoansInBatchInput;
    CreateLoantypeInput: CreateLoantypeInput;
    CreateLocationInput: CreateLocationInput;
    CreateNewLeaderInput: CreateNewLeaderInput;
    CreateNewLeaderResult: CreateNewLeaderResult;
    CreatePersonalDataInput: CreatePersonalDataInput;
    CreatePhoneInput: CreatePhoneInput;
    CreatePortfolioCleanupInput: CreatePortfolioCleanupInput;
    CreateReportConfigInput: CreateReportConfigInput;
    CreateRouteInput: CreateRouteInput;
    CreateSingleLoanInput: CreateSingleLoanInput;
    CreateTransactionInput: CreateTransactionInput;
    CreateUserInput: CreateUserInput;
    DateTime: Scalars['DateTime']['output'];
    DeadDebtBorrower: DeadDebtBorrower;
    DeadDebtCriteria: DeadDebtCriteria;
    DeadDebtLead: DeadDebtLead;
    DeadDebtLoan: DeadDebtLoan;
    DeadDebtMonthSummary: DeadDebtMonthSummary;
    DeadDebtMonthlySummaryResult: DeadDebtMonthlySummaryResult;
    DeadDebtPayment: DeadDebtPayment;
    DeadDebtQueryResult: DeadDebtQueryResult;
    DeadDebtSummaryByLocality: DeadDebtSummaryByLocality;
    DeadDebtTotals: DeadDebtTotals;
    Decimal: Scalars['Decimal']['output'];
    DistributeMoneyInput: DistributeMoneyInput;
    DocumentNotificationLog: DocumentNotificationLog;
    DocumentPhoto: DocumentPhoto;
    DocumentWithNotificationStatus: DocumentWithNotificationStatus;
    DrainRoutesInput: DrainRoutesInput;
    Employee: Employee;
    EmployeeWithStats: EmployeeWithStats;
    EvaluationPeriod: EvaluationPeriod;
    ExistingLeaderInfo: ExistingLeaderInfo;
    FinancialReport: FinancialReport;
    FinancialSummary: FinancialSummary;
    FirstPaymentInput: FirstPaymentInput;
    Float: Scalars['Float']['output'];
    ID: Scalars['ID']['output'];
    Int: Scalars['Int']['output'];
    JSON: Scalars['JSON']['output'];
    LeadPaymentReceived: LeadPaymentReceived;
    LeaderInfo: LeaderInfo;
    LinkTelegramToUserInput: LinkTelegramToUserInput;
    Loan: Loan;
    LoanConnection: LoanConnection;
    LoanEdge: LoanEdge;
    LoanHistoryDetail: LoanHistoryDetail;
    LoanPayment: LoanPayment;
    LoanPaymentDetail: LoanPaymentDetail;
    Loantype: Loantype;
    LocalityBreakdownDetail: LocalityBreakdownDetail;
    LocalityClientDetail: LocalityClientDetail;
    LocalityReport: LocalityReport;
    LocalitySummary: LocalitySummary;
    LocalityWeekData: LocalityWeekData;
    Location: Location;
    LocationBreakdown: LocationBreakdown;
    MarkDeadDebtResult: MarkDeadDebtResult;
    MarkDocumentAsMissingInput: MarkDocumentAsMissingInput;
    MonthInfo: MonthInfo;
    MonthlyFinancialData: MonthlyFinancialData;
    Municipality: Municipality;
    Mutation: {};
    NoPaymentPeriod: NoPaymentPeriod;
    PDFGenerationResult: PdfGenerationResult;
    PageInfo: PageInfo;
    PaymentForLeadInput: PaymentForLeadInput;
    PerformanceMetrics: PerformanceMetrics;
    PeriodComparison: PeriodComparison;
    PersonalData: PersonalData;
    Phone: Phone;
    PortfolioCleanup: PortfolioCleanup;
    PortfolioFiltersInput: PortfolioFiltersInput;
    PortfolioReport: PortfolioReport;
    PortfolioSummary: PortfolioSummary;
    Query: {};
    RecoveredDeadDebtPayment: RecoveredDeadDebtPayment;
    RecoveredDeadDebtResult: RecoveredDeadDebtResult;
    RecoveredDeadDebtSummary: RecoveredDeadDebtSummary;
    RenewLoanInput: RenewLoanInput;
    RenovationKPIs: RenovationKpIs;
    ReportConfig: ReportConfig;
    ReportExecutionLog: ReportExecutionLog;
    ReportExecutionResult: ReportExecutionResult;
    ReportSchedule: ReportSchedule;
    ReportScheduleInput: ReportScheduleInput;
    Route: Route;
    RouteAmountInput: RouteAmountInput;
    RouteInfo: RouteInfo;
    RouteWithStats: RouteWithStats;
    SendDocumentNotificationInput: SendDocumentNotificationInput;
    SendNotificationResult: SendNotificationResult;
    State: State;
    String: Scalars['String']['output'];
    TelegramUser: TelegramUser;
    TelegramUserFiltersInput: TelegramUserFiltersInput;
    TelegramUserStats: TelegramUserStats;
    Transaction: Transaction;
    TransactionConnection: TransactionConnection;
    TransactionEdge: TransactionEdge;
    TransferInput: TransferInput;
    UpdateAccountInput: UpdateAccountInput;
    UpdateBorrowerInput: UpdateBorrowerInput;
    UpdateDocumentInput: UpdateDocumentInput;
    UpdateEmployeeInput: UpdateEmployeeInput;
    UpdateLeadPaymentReceivedInput: UpdateLeadPaymentReceivedInput;
    UpdateLoanExtendedInput: UpdateLoanExtendedInput;
    UpdateLoanInput: UpdateLoanInput;
    UpdateLoanPaymentInput: UpdateLoanPaymentInput;
    UpdateLoantypeInput: UpdateLoantypeInput;
    UpdatePaymentForLeadInput: UpdatePaymentForLeadInput;
    UpdatePersonalDataInput: UpdatePersonalDataInput;
    UpdatePhoneInput: UpdatePhoneInput;
    UpdatePortfolioCleanupInput: UpdatePortfolioCleanupInput;
    UpdateReportConfigInput: UpdateReportConfigInput;
    UpdateRouteInput: UpdateRouteInput;
    UpdateTelegramUserInput: UpdateTelegramUserInput;
    UpdateTransactionInput: UpdateTransactionInput;
    UpdateUserInput: UpdateUserInput;
    Upload: Scalars['Upload']['output'];
    UploadDocumentInput: UploadDocumentInput;
    User: User;
    WeekInfo: WeekInfo;
    WeekRange: WeekRange;
    WeeklyData: WeeklyData;
    WeeklyPortfolioData: WeeklyPortfolioData;
}>;
export type AuthDirectiveArgs = {};
export type AuthDirectiveResolver<Result, Parent, ContextType = GraphQLContext, Args = AuthDirectiveArgs> = DirectiveResolverFn<Result, Parent, ContextType, Args>;
export type RequireRoleDirectiveArgs = {
    roles: Array<UserRole>;
};
export type RequireRoleDirectiveResolver<Result, Parent, ContextType = GraphQLContext, Args = RequireRoleDirectiveArgs> = DirectiveResolverFn<Result, Parent, ContextType, Args>;
export type AccountResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Account'] = ResolversParentTypes['Account']> = ResolversObject<{
    accountBalance?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    amount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    routes?: Resolver<Array<ResolversTypes['Route']>, ParentType, ContextType>;
    transactionsDestination?: Resolver<Array<ResolversTypes['Transaction']>, ParentType, ContextType>;
    transactionsSource?: Resolver<Array<ResolversTypes['Transaction']>, ParentType, ContextType>;
    type?: Resolver<ResolversTypes['AccountType'], ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ActiveClientStatusResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ActiveClientStatus'] = ResolversParentTypes['ActiveClientStatus']> = ResolversObject<{
    borrowerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    clientName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    cvStatus?: Resolver<ResolversTypes['CVStatus'], ParentType, ContextType>;
    daysSinceLastPayment?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    loanId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    locationName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    pendingAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    routeName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ActiveLoansBreakdownResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ActiveLoansBreakdown'] = ResolversParentTypes['ActiveLoansBreakdown']> = ResolversObject<{
    alCorriente?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    carteraVencida?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    total?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type AddressResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Address'] = ResolversParentTypes['Address']> = ResolversObject<{
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    location?: Resolver<ResolversTypes['Location'], ParentType, ContextType>;
    numberExterior?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    numberInterior?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    personalData?: Resolver<ResolversTypes['PersonalData'], ParentType, ContextType>;
    street?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    zipCode?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type AnnualFinancialReportResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AnnualFinancialReport'] = ResolversParentTypes['AnnualFinancialReport']> = ResolversObject<{
    annualWeeklyAverageExpenses?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    annualWeeklyAverageIncome?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    annualWeeklyAverageProfit?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    data?: Resolver<Array<ResolversTypes['MonthlyFinancialData']>, ParentType, ContextType>;
    months?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
    routes?: Resolver<Array<ResolversTypes['RouteInfo']>, ParentType, ContextType>;
    totalActiveWeeks?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    year?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type AuthPayloadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['AuthPayload'] = ResolversParentTypes['AuthPayload']> = ResolversObject<{
    accessToken?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    refreshToken?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    user?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type BadDebtDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['BadDebtData'] = ResolversParentTypes['BadDebtData']> = ResolversObject<{
    loanCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    routeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    routeName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    totalAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type BadDebtSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['BadDebtSummary'] = ResolversParentTypes['BadDebtSummary']> = ResolversObject<{
    byRoute?: Resolver<Array<ResolversTypes['BadDebtData']>, ParentType, ContextType>;
    totalAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalLoans?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type BankIncomeTransactionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['BankIncomeTransaction'] = ResolversParentTypes['BankIncomeTransaction']> = ResolversObject<{
    amount?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
    date?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    employeeName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    incomeSource?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    isClientPayment?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    isLeaderPayment?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    leaderLocality?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    locality?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type BankIncomeTransactionsResponseResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['BankIncomeTransactionsResponse'] = ResolversParentTypes['BankIncomeTransactionsResponse']> = ResolversObject<{
    message?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    transactions?: Resolver<Array<ResolversTypes['BankIncomeTransaction']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type BatchTransferResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['BatchTransferResult'] = ResolversParentTypes['BatchTransferResult']> = ResolversObject<{
    message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    totalAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    transactions?: Resolver<Array<ResolversTypes['Transaction']>, ParentType, ContextType>;
    transactionsCreated?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type BorrowerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Borrower'] = ResolversParentTypes['Borrower']> = ResolversObject<{
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    loanFinishedCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    loans?: Resolver<Array<ResolversTypes['Loan']>, ParentType, ContextType>;
    personalData?: Resolver<ResolversTypes['PersonalData'], ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type BorrowerSearchResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['BorrowerSearchResult'] = ResolversParentTypes['BorrowerSearchResult']> = ResolversObject<{
    hasActiveLoans?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    isFromCurrentLocation?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    loanFinishedCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    locationId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
    locationName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    pendingDebtAmount?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    personalData?: Resolver<ResolversTypes['PersonalData'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type CleanupLoanPreviewResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CleanupLoanPreview'] = ResolversParentTypes['CleanupLoanPreview']> = ResolversObject<{
    clientCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    clientName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    pendingAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    routeName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    signDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type CleanupPreviewResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CleanupPreview'] = ResolversParentTypes['CleanupPreview']> = ResolversObject<{
    sampleLoans?: Resolver<Array<ResolversTypes['CleanupLoanPreview']>, ParentType, ContextType>;
    totalLoans?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalPendingAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ClientAddressInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ClientAddressInfo'] = ResolversParentTypes['ClientAddressInfo']> = ResolversObject<{
    city?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    location?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    route?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    street?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ClientBalanceDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ClientBalanceData'] = ResolversParentTypes['ClientBalanceData']> = ResolversObject<{
    balance?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    nuevos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    renovados?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    terminadosSinRenovar?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    trend?: Resolver<ResolversTypes['Trend'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ClientHistoryDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ClientHistoryData'] = ResolversParentTypes['ClientHistoryData']> = ResolversObject<{
    client?: Resolver<ResolversTypes['ClientInfo'], ParentType, ContextType>;
    loansAsClient?: Resolver<Array<ResolversTypes['LoanHistoryDetail']>, ParentType, ContextType>;
    loansAsCollateral?: Resolver<Array<ResolversTypes['LoanHistoryDetail']>, ParentType, ContextType>;
    summary?: Resolver<ResolversTypes['ClientSummary'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ClientInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ClientInfo'] = ResolversParentTypes['ClientInfo']> = ResolversObject<{
    addresses?: Resolver<Array<ResolversTypes['ClientAddressInfo']>, ParentType, ContextType>;
    clientCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    fullName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    leader?: Resolver<Maybe<ResolversTypes['LeaderInfo']>, ParentType, ContextType>;
    phones?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ClientSearchResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ClientSearchResult'] = ResolversParentTypes['ClientSearchResult']> = ResolversObject<{
    activeLoans?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    address?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    clientCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    collateralLoans?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    finishedLoans?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    hasBeenCollateral?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    hasLoans?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    latestLoanDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    location?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    municipality?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    phone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    route?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    state?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    totalLoans?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ClientSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ClientSummary'] = ResolversParentTypes['ClientSummary']> = ResolversObject<{
    activeLoansAsClient?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    activeLoansAsCollateral?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    currentPendingDebtAsClient?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    hasBeenClient?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    hasBeenCollateral?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    totalAmountPaidAsClient?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalAmountRequestedAsClient?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalLoansAsClient?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalLoansAsCollateral?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type CommissionPaymentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CommissionPayment'] = ResolversParentTypes['CommissionPayment']> = ResolversObject<{
    amount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    employee?: Resolver<ResolversTypes['Employee'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    loan?: Resolver<ResolversTypes['Loan'], ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ComparisonDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ComparisonData'] = ResolversParentTypes['ComparisonData']> = ResolversObject<{
    growth?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    previousMonth?: Resolver<ResolversTypes['FinancialSummary'], ParentType, ContextType>;
    trend?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type CreateNewLeaderResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreateNewLeaderResult'] = ResolversParentTypes['CreateNewLeaderResult']> = ResolversObject<{
    loansTransferred?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    newLeaderId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
    success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
    name: 'DateTime';
}
export type DeadDebtBorrowerResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtBorrower'] = ResolversParentTypes['DeadDebtBorrower']> = ResolversObject<{
    clientCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    fullName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtCriteriaResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtCriteria'] = ResolversParentTypes['DeadDebtCriteria']> = ResolversObject<{
    badDebtStatus?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    localities?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
    weeksSinceLoanMin?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    weeksWithoutPaymentMin?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtLeadResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtLead'] = ResolversParentTypes['DeadDebtLead']> = ResolversObject<{
    fullName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    locality?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    route?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtLoanResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtLoan'] = ResolversParentTypes['DeadDebtLoan']> = ResolversObject<{
    amountGived?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    badDebtCandidate?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    badDebtDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    borrower?: Resolver<ResolversTypes['DeadDebtBorrower'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    lead?: Resolver<ResolversTypes['DeadDebtLead'], ParentType, ContextType>;
    payments?: Resolver<Array<ResolversTypes['DeadDebtPayment']>, ParentType, ContextType>;
    pendingAmountStored?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    signDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    weeksSinceLoan?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    weeksWithoutPayment?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtMonthSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtMonthSummary'] = ResolversParentTypes['DeadDebtMonthSummary']> = ResolversObject<{
    criteria?: Resolver<ResolversTypes['DeadDebtCriteria'], ParentType, ContextType>;
    evaluationPeriod?: Resolver<ResolversTypes['EvaluationPeriod'], ParentType, ContextType>;
    loans?: Resolver<Array<ResolversTypes['DeadDebtLoan']>, ParentType, ContextType>;
    month?: Resolver<ResolversTypes['MonthInfo'], ParentType, ContextType>;
    summary?: Resolver<ResolversTypes['DeadDebtTotals'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtMonthlySummaryResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtMonthlySummaryResult'] = ResolversParentTypes['DeadDebtMonthlySummaryResult']> = ResolversObject<{
    monthlySummary?: Resolver<Array<ResolversTypes['DeadDebtMonthSummary']>, ParentType, ContextType>;
    routesInfo?: Resolver<Array<ResolversTypes['RouteInfo']>, ParentType, ContextType>;
    year?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    yearTotals?: Resolver<ResolversTypes['DeadDebtTotals'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtPaymentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtPayment'] = ResolversParentTypes['DeadDebtPayment']> = ResolversObject<{
    amount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    receivedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtQueryResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtQueryResult'] = ResolversParentTypes['DeadDebtQueryResult']> = ResolversObject<{
    loans?: Resolver<Array<ResolversTypes['DeadDebtLoan']>, ParentType, ContextType>;
    localities?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
    summary?: Resolver<ResolversTypes['DeadDebtTotals'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtSummaryByLocalityResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtSummaryByLocality'] = ResolversParentTypes['DeadDebtSummaryByLocality']> = ResolversObject<{
    loanCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    locality?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    totalBadDebtCandidate?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalPending?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DeadDebtTotalsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DeadDebtTotals'] = ResolversParentTypes['DeadDebtTotals']> = ResolversObject<{
    totalBadDebtCandidate?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalLoans?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalPendingAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export interface DecimalScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Decimal'], any> {
    name: 'Decimal';
}
export type DocumentNotificationLogResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DocumentNotificationLog'] = ResolversParentTypes['DocumentNotificationLog']> = ResolversObject<{
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    documentId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    documentType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    issueType?: Resolver<ResolversTypes['IssueType'], ParentType, ContextType>;
    lastRetryAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    loanId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    localityName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    messageContent?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    notes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    personName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    personalDataId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    responseTimeMs?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    retryCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    routeId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    routeLeadId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    routeLeadName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    routeName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    sentAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    status?: Resolver<ResolversTypes['NotificationStatus'], ParentType, ContextType>;
    telegramChatId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    telegramErrorCode?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    telegramErrorMessage?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    telegramResponse?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    telegramUserId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    telegramUsername?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DocumentPhotoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DocumentPhoto'] = ResolversParentTypes['DocumentPhoto']> = ResolversObject<{
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    documentType?: Resolver<ResolversTypes['DocumentType'], ParentType, ContextType>;
    errorDescription?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    isError?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    isMissing?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    loan?: Resolver<Maybe<ResolversTypes['Loan']>, ParentType, ContextType>;
    personalData?: Resolver<Maybe<ResolversTypes['PersonalData']>, ParentType, ContextType>;
    photoUrl?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    publicId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    title?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    uploadedBy?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type DocumentWithNotificationStatusResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['DocumentWithNotificationStatus'] = ResolversParentTypes['DocumentWithNotificationStatus']> = ResolversObject<{
    document?: Resolver<ResolversTypes['DocumentPhoto'], ParentType, ContextType>;
    lastNotification?: Resolver<Maybe<ResolversTypes['DocumentNotificationLog']>, ParentType, ContextType>;
    notificationSent?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type EmployeeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Employee'] = ResolversParentTypes['Employee']> = ResolversObject<{
    commissionPayments?: Resolver<Array<ResolversTypes['CommissionPayment']>, ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    loansGranted?: Resolver<Array<ResolversTypes['Loan']>, ParentType, ContextType>;
    loansManagedAsLead?: Resolver<Array<ResolversTypes['Loan']>, ParentType, ContextType>;
    location?: Resolver<Maybe<ResolversTypes['Location']>, ParentType, ContextType>;
    personalData?: Resolver<ResolversTypes['PersonalData'], ParentType, ContextType>;
    routes?: Resolver<Array<ResolversTypes['Route']>, ParentType, ContextType>;
    transactions?: Resolver<Array<ResolversTypes['Transaction']>, ParentType, ContextType>;
    type?: Resolver<ResolversTypes['EmployeeType'], ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    user?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type EmployeeWithStatsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['EmployeeWithStats'] = ResolversParentTypes['EmployeeWithStats']> = ResolversObject<{
    activos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    alCorriente?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    enCV?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    personalData?: Resolver<Maybe<ResolversTypes['PersonalData']>, ParentType, ContextType>;
    type?: Resolver<ResolversTypes['EmployeeType'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type EvaluationPeriodResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['EvaluationPeriod'] = ResolversParentTypes['EvaluationPeriod']> = ResolversObject<{
    description?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    from?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    to?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ExistingLeaderInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ExistingLeaderInfo'] = ResolversParentTypes['ExistingLeaderInfo']> = ResolversObject<{
    fullName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    locationName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type FinancialReportResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['FinancialReport'] = ResolversParentTypes['FinancialReport']> = ResolversObject<{
    comparisonData?: Resolver<Maybe<ResolversTypes['ComparisonData']>, ParentType, ContextType>;
    performanceMetrics?: Resolver<ResolversTypes['PerformanceMetrics'], ParentType, ContextType>;
    summary?: Resolver<ResolversTypes['FinancialSummary'], ParentType, ContextType>;
    weeklyData?: Resolver<Array<ResolversTypes['WeeklyData']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type FinancialSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['FinancialSummary'] = ResolversParentTypes['FinancialSummary']> = ResolversObject<{
    activeLoans?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    activeLoansBreakdown?: Resolver<ResolversTypes['ActiveLoansBreakdown'], ParentType, ContextType>;
    averagePayment?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    pendingAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalPaid?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalPortfolio?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export interface JsonScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
    name: 'JSON';
}
export type LeadPaymentReceivedResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LeadPaymentReceived'] = ResolversParentTypes['LeadPaymentReceived']> = ResolversObject<{
    agent?: Resolver<ResolversTypes['Employee'], ParentType, ContextType>;
    bankPaidAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    cashPaidAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    expectedAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    falcoAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    lead?: Resolver<ResolversTypes['Employee'], ParentType, ContextType>;
    paidAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    paymentStatus?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    payments?: Resolver<Array<ResolversTypes['LoanPayment']>, ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LeaderInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LeaderInfo'] = ResolversParentTypes['LeaderInfo']> = ResolversObject<{
    location?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    municipality?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    phone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    route?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    state?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LoanResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Loan'] = ResolversParentTypes['Loan']> = ResolversObject<{
    amountGived?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    badDebtDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    borrower?: Resolver<ResolversTypes['Borrower'], ParentType, ContextType>;
    collaterals?: Resolver<Array<ResolversTypes['PersonalData']>, ParentType, ContextType>;
    comissionAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    documentPhotos?: Resolver<Array<ResolversTypes['DocumentPhoto']>, ParentType, ContextType>;
    expectedWeeklyPayment?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    finishedDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    grantor?: Resolver<ResolversTypes['Employee'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    isDeceased?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    lead?: Resolver<ResolversTypes['Employee'], ParentType, ContextType>;
    loantype?: Resolver<ResolversTypes['Loantype'], ParentType, ContextType>;
    payments?: Resolver<Array<ResolversTypes['LoanPayment']>, ParentType, ContextType>;
    pendingAmountStored?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    previousLoan?: Resolver<Maybe<ResolversTypes['Loan']>, ParentType, ContextType>;
    profitAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    renewedBy?: Resolver<Maybe<ResolversTypes['Loan']>, ParentType, ContextType>;
    requestedAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    signDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    snapshotLeadAssignedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    snapshotLeadId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    snapshotLeadName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    snapshotRouteId?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    snapshotRouteName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    status?: Resolver<ResolversTypes['LoanStatus'], ParentType, ContextType>;
    totalDebtAcquired?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalPaid?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    transactions?: Resolver<Array<ResolversTypes['Transaction']>, ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LoanConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LoanConnection'] = ResolversParentTypes['LoanConnection']> = ResolversObject<{
    edges?: Resolver<Array<ResolversTypes['LoanEdge']>, ParentType, ContextType>;
    pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
    totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LoanEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LoanEdge'] = ResolversParentTypes['LoanEdge']> = ResolversObject<{
    cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    node?: Resolver<ResolversTypes['Loan'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LoanHistoryDetailResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LoanHistoryDetail'] = ResolversParentTypes['LoanHistoryDetail']> = ResolversObject<{
    amountRequested?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    avalName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    avalPhone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    clientDui?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    clientName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    daysSinceSign?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    finishedDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    finishedDateFormatted?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    interestAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    leadName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    loanType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    noPaymentPeriods?: Resolver<Array<ResolversTypes['NoPaymentPeriod']>, ParentType, ContextType>;
    payments?: Resolver<Array<ResolversTypes['LoanPaymentDetail']>, ParentType, ContextType>;
    paymentsCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    pendingDebt?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    rate?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    renewedDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    renewedFrom?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
    renewedTo?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
    routeName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    signDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    signDateFormatted?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    totalAmountDue?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalPaid?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    wasRenewed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    weekDuration?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LoanPaymentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LoanPayment'] = ResolversParentTypes['LoanPayment']> = ResolversObject<{
    amount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    comission?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    leadPaymentReceived?: Resolver<Maybe<ResolversTypes['LeadPaymentReceived']>, ParentType, ContextType>;
    loan?: Resolver<ResolversTypes['Loan'], ParentType, ContextType>;
    paymentMethod?: Resolver<ResolversTypes['PaymentMethod'], ParentType, ContextType>;
    receivedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    transactions?: Resolver<Array<ResolversTypes['Transaction']>, ParentType, ContextType>;
    type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LoanPaymentDetailResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LoanPaymentDetail'] = ResolversParentTypes['LoanPaymentDetail']> = ResolversObject<{
    amount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    balanceAfterPayment?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    balanceBeforePayment?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    paymentMethod?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    paymentNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    receivedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    receivedAtFormatted?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LoantypeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Loantype'] = ResolversParentTypes['Loantype']> = ResolversObject<{
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    loanGrantedComission?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    loanPaymentComission?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    rate?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    weekDuration?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LocalityBreakdownDetailResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LocalityBreakdownDetail'] = ResolversParentTypes['LocalityBreakdownDetail']> = ResolversObject<{
    localityId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    localityName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    routeId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
    routeName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    summary?: Resolver<ResolversTypes['LocalitySummary'], ParentType, ContextType>;
    weeklyData?: Resolver<Array<ResolversTypes['LocalityWeekData']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LocalityClientDetailResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LocalityClientDetail'] = ResolversParentTypes['LocalityClientDetail']> = ResolversObject<{
    amountGived?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    category?: Resolver<ResolversTypes['ClientCategory'], ParentType, ContextType>;
    clientCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    clientName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    cvStatus?: Resolver<ResolversTypes['CVStatus'], ParentType, ContextType>;
    daysSinceLastPayment?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    loanId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    loanType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    pendingAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    signDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LocalityReportResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LocalityReport'] = ResolversParentTypes['LocalityReport']> = ResolversObject<{
    localities?: Resolver<Array<ResolversTypes['LocalityBreakdownDetail']>, ParentType, ContextType>;
    month?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    periodType?: Resolver<ResolversTypes['PeriodType'], ParentType, ContextType>;
    totals?: Resolver<ResolversTypes['LocalitySummary'], ParentType, ContextType>;
    weekNumber?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    weeks?: Resolver<Array<ResolversTypes['WeekRange']>, ParentType, ContextType>;
    year?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LocalitySummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LocalitySummary'] = ResolversParentTypes['LocalitySummary']> = ResolversObject<{
    alCorrientePromedio?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
    balance?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    cvPromedio?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
    porcentajePagando?: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
    totalClientesActivos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalClientesAlCorriente?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalClientesEnCV?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalFinalizados?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalNuevos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalReintegros?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalRenovados?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LocalityWeekDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LocalityWeekData'] = ResolversParentTypes['LocalityWeekData']> = ResolversObject<{
    balance?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesActivos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesAlCorriente?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesEnCV?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    finalizados?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    isCompleted?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    nuevos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    reintegros?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    renovados?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    weekRange?: Resolver<ResolversTypes['WeekRange'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LocationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Location'] = ResolversParentTypes['Location']> = ResolversObject<{
    addresses?: Resolver<Array<ResolversTypes['Address']>, ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    municipality?: Resolver<ResolversTypes['Municipality'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    route?: Resolver<Maybe<ResolversTypes['Route']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type LocationBreakdownResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['LocationBreakdown'] = ResolversParentTypes['LocationBreakdown']> = ResolversObject<{
    balance?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesActivos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesAlCorriente?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesEnCV?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    locationId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    locationName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    routeId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
    routeName?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type MarkDeadDebtResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MarkDeadDebtResult'] = ResolversParentTypes['MarkDeadDebtResult']> = ResolversObject<{
    count?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type MonthInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MonthInfo'] = ResolversParentTypes['MonthInfo']> = ResolversObject<{
    endDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    month?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    startDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    year?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type MonthlyFinancialDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['MonthlyFinancialData'] = ResolversParentTypes['MonthlyFinancialData']> = ResolversObject<{
    activeWeeks?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    availableCash?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    badDebtAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    capitalReturn?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    carteraActiva?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    carteraMuerta?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    carteraVencida?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    cashGasolina?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    comissions?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    gainPerPayment?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    generalExpenses?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    incomes?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    loanDisbursements?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    month?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    nomina?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    nominaInterna?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    operationalCashUsed?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    operationalProfit?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    paymentsCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    profitPercentage?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    profitReturn?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    renovados?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    salarioExterno?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    tokaGasolina?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalExpenses?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalGasolina?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalIncomingCash?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    totalInvestment?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    travelExpenses?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    viaticos?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    weeklyAverageExpenses?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    weeklyAverageIncome?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    weeklyAverageProfit?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type MunicipalityResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Municipality'] = ResolversParentTypes['Municipality']> = ResolversObject<{
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    locations?: Resolver<Array<ResolversTypes['Location']>, ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    state?: Resolver<ResolversTypes['State'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
    activateTelegramUser?: Resolver<ResolversTypes['TelegramUser'], ParentType, ContextType, RequireFields<MutationActivateTelegramUserArgs, 'id'>>;
    cancelLoan?: Resolver<ResolversTypes['Loan'], ParentType, ContextType, RequireFields<MutationCancelLoanArgs, 'id'>>;
    cancelLoanWithAccountRestore?: Resolver<ResolversTypes['Loan'], ParentType, ContextType, RequireFields<MutationCancelLoanWithAccountRestoreArgs, 'accountId' | 'id'>>;
    changePassword?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationChangePasswordArgs, 'newPassword' | 'oldPassword'>>;
    createAccount?: Resolver<ResolversTypes['Account'], ParentType, ContextType, RequireFields<MutationCreateAccountArgs, 'input'>>;
    createBorrower?: Resolver<ResolversTypes['Borrower'], ParentType, ContextType, RequireFields<MutationCreateBorrowerArgs, 'input'>>;
    createEmployee?: Resolver<ResolversTypes['Employee'], ParentType, ContextType, RequireFields<MutationCreateEmployeeArgs, 'input'>>;
    createLeadPaymentReceived?: Resolver<ResolversTypes['LeadPaymentReceived'], ParentType, ContextType, RequireFields<MutationCreateLeadPaymentReceivedArgs, 'input'>>;
    createLoan?: Resolver<ResolversTypes['Loan'], ParentType, ContextType, RequireFields<MutationCreateLoanArgs, 'input'>>;
    createLoanPayment?: Resolver<ResolversTypes['LoanPayment'], ParentType, ContextType, RequireFields<MutationCreateLoanPaymentArgs, 'input'>>;
    createLoansInBatch?: Resolver<Array<ResolversTypes['Loan']>, ParentType, ContextType, RequireFields<MutationCreateLoansInBatchArgs, 'input'>>;
    createLoantype?: Resolver<ResolversTypes['Loantype'], ParentType, ContextType, RequireFields<MutationCreateLoantypeArgs, 'input'>>;
    createLocation?: Resolver<ResolversTypes['Location'], ParentType, ContextType, RequireFields<MutationCreateLocationArgs, 'input'>>;
    createNewLeader?: Resolver<ResolversTypes['CreateNewLeaderResult'], ParentType, ContextType, RequireFields<MutationCreateNewLeaderArgs, 'input'>>;
    createPortfolioCleanup?: Resolver<ResolversTypes['PortfolioCleanup'], ParentType, ContextType, RequireFields<MutationCreatePortfolioCleanupArgs, 'input'>>;
    createReportConfig?: Resolver<ResolversTypes['ReportConfig'], ParentType, ContextType, RequireFields<MutationCreateReportConfigArgs, 'input'>>;
    createRoute?: Resolver<ResolversTypes['Route'], ParentType, ContextType, RequireFields<MutationCreateRouteArgs, 'input'>>;
    createTransaction?: Resolver<ResolversTypes['Transaction'], ParentType, ContextType, RequireFields<MutationCreateTransactionArgs, 'input'>>;
    createUser?: Resolver<ResolversTypes['User'], ParentType, ContextType, RequireFields<MutationCreateUserArgs, 'input'>>;
    deactivateTelegramUser?: Resolver<ResolversTypes['TelegramUser'], ParentType, ContextType, RequireFields<MutationDeactivateTelegramUserArgs, 'id'>>;
    deleteDocumentPhoto?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteDocumentPhotoArgs, 'id'>>;
    deleteLoanPayment?: Resolver<ResolversTypes['LoanPayment'], ParentType, ContextType, RequireFields<MutationDeleteLoanPaymentArgs, 'id'>>;
    deletePortfolioCleanup?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeletePortfolioCleanupArgs, 'id'>>;
    deleteReportConfig?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteReportConfigArgs, 'id'>>;
    deleteTelegramUser?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteTelegramUserArgs, 'id'>>;
    deleteTransaction?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteTransactionArgs, 'id'>>;
    deleteUser?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType, RequireFields<MutationDeleteUserArgs, 'id'>>;
    distributeMoney?: Resolver<ResolversTypes['BatchTransferResult'], ParentType, ContextType, RequireFields<MutationDistributeMoneyArgs, 'input'>>;
    drainRoutes?: Resolver<ResolversTypes['BatchTransferResult'], ParentType, ContextType, RequireFields<MutationDrainRoutesArgs, 'input'>>;
    executeReportManually?: Resolver<ResolversTypes['ReportExecutionResult'], ParentType, ContextType, RequireFields<MutationExecuteReportManuallyArgs, 'reportConfigId'>>;
    finishLoan?: Resolver<ResolversTypes['Loan'], ParentType, ContextType, RequireFields<MutationFinishLoanArgs, 'loanId'>>;
    generatePortfolioReportPDF?: Resolver<ResolversTypes['PDFGenerationResult'], ParentType, ContextType, RequireFields<MutationGeneratePortfolioReportPdfArgs, 'periodType' | 'year'>>;
    linkTelegramToUser?: Resolver<ResolversTypes['TelegramUser'], ParentType, ContextType, RequireFields<MutationLinkTelegramToUserArgs, 'input'>>;
    login?: Resolver<ResolversTypes['AuthPayload'], ParentType, ContextType, RequireFields<MutationLoginArgs, 'email' | 'password'>>;
    logout?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    markDocumentAsMissing?: Resolver<ResolversTypes['DocumentPhoto'], ParentType, ContextType, RequireFields<MutationMarkDocumentAsMissingArgs, 'input'>>;
    markLoanAsBadDebt?: Resolver<ResolversTypes['Loan'], ParentType, ContextType, RequireFields<MutationMarkLoanAsBadDebtArgs, 'badDebtDate' | 'loanId'>>;
    markLoansAsDeadDebt?: Resolver<ResolversTypes['MarkDeadDebtResult'], ParentType, ContextType, RequireFields<MutationMarkLoansAsDeadDebtArgs, 'deadDebtDate' | 'loanIds'>>;
    promoteToLead?: Resolver<ResolversTypes['Employee'], ParentType, ContextType, RequireFields<MutationPromoteToLeadArgs, 'employeeId'>>;
    refreshToken?: Resolver<ResolversTypes['AuthPayload'], ParentType, ContextType, RequireFields<MutationRefreshTokenArgs, 'refreshToken'>>;
    renewLoan?: Resolver<ResolversTypes['Loan'], ParentType, ContextType, RequireFields<MutationRenewLoanArgs, 'input' | 'loanId'>>;
    retryFailedNotification?: Resolver<ResolversTypes['SendNotificationResult'], ParentType, ContextType, RequireFields<MutationRetryFailedNotificationArgs, 'notificationId'>>;
    sendBulkDocumentNotifications?: Resolver<Array<ResolversTypes['SendNotificationResult']>, ParentType, ContextType, RequireFields<MutationSendBulkDocumentNotificationsArgs, 'documentIds' | 'recipientChatIds'>>;
    sendDocumentNotification?: Resolver<ResolversTypes['SendNotificationResult'], ParentType, ContextType, RequireFields<MutationSendDocumentNotificationArgs, 'input'>>;
    toggleReportConfig?: Resolver<ResolversTypes['ReportConfig'], ParentType, ContextType, RequireFields<MutationToggleReportConfigArgs, 'id'>>;
    transferBetweenAccounts?: Resolver<ResolversTypes['Transaction'], ParentType, ContextType, RequireFields<MutationTransferBetweenAccountsArgs, 'input'>>;
    unlinkTelegramFromUser?: Resolver<ResolversTypes['TelegramUser'], ParentType, ContextType, RequireFields<MutationUnlinkTelegramFromUserArgs, 'telegramUserId'>>;
    updateAccount?: Resolver<ResolversTypes['Account'], ParentType, ContextType, RequireFields<MutationUpdateAccountArgs, 'id' | 'input'>>;
    updateBorrower?: Resolver<ResolversTypes['Borrower'], ParentType, ContextType, RequireFields<MutationUpdateBorrowerArgs, 'id' | 'input'>>;
    updateDocumentPhoto?: Resolver<ResolversTypes['DocumentPhoto'], ParentType, ContextType, RequireFields<MutationUpdateDocumentPhotoArgs, 'id' | 'input'>>;
    updateEmployee?: Resolver<ResolversTypes['Employee'], ParentType, ContextType, RequireFields<MutationUpdateEmployeeArgs, 'id' | 'input'>>;
    updateLeadPaymentReceived?: Resolver<ResolversTypes['LeadPaymentReceived'], ParentType, ContextType, RequireFields<MutationUpdateLeadPaymentReceivedArgs, 'id' | 'input'>>;
    updateLoan?: Resolver<ResolversTypes['Loan'], ParentType, ContextType, RequireFields<MutationUpdateLoanArgs, 'id' | 'input'>>;
    updateLoanExtended?: Resolver<ResolversTypes['Loan'], ParentType, ContextType, RequireFields<MutationUpdateLoanExtendedArgs, 'id' | 'input'>>;
    updateLoanPayment?: Resolver<ResolversTypes['LoanPayment'], ParentType, ContextType, RequireFields<MutationUpdateLoanPaymentArgs, 'id' | 'input'>>;
    updateLoantype?: Resolver<ResolversTypes['Loantype'], ParentType, ContextType, RequireFields<MutationUpdateLoantypeArgs, 'id' | 'input'>>;
    updatePersonalData?: Resolver<ResolversTypes['PersonalData'], ParentType, ContextType, RequireFields<MutationUpdatePersonalDataArgs, 'fullName' | 'id'>>;
    updatePhone?: Resolver<ResolversTypes['Phone'], ParentType, ContextType, RequireFields<MutationUpdatePhoneArgs, 'input'>>;
    updatePortfolioCleanup?: Resolver<ResolversTypes['PortfolioCleanup'], ParentType, ContextType, RequireFields<MutationUpdatePortfolioCleanupArgs, 'id' | 'input'>>;
    updateReportConfig?: Resolver<ResolversTypes['ReportConfig'], ParentType, ContextType, RequireFields<MutationUpdateReportConfigArgs, 'id' | 'input'>>;
    updateRoute?: Resolver<ResolversTypes['Route'], ParentType, ContextType, RequireFields<MutationUpdateRouteArgs, 'id' | 'input'>>;
    updateTelegramUser?: Resolver<ResolversTypes['TelegramUser'], ParentType, ContextType, RequireFields<MutationUpdateTelegramUserArgs, 'id' | 'input'>>;
    updateTransaction?: Resolver<ResolversTypes['Transaction'], ParentType, ContextType, RequireFields<MutationUpdateTransactionArgs, 'id' | 'input'>>;
    updateUser?: Resolver<ResolversTypes['User'], ParentType, ContextType, RequireFields<MutationUpdateUserArgs, 'id' | 'input'>>;
    uploadDocumentPhoto?: Resolver<ResolversTypes['DocumentPhoto'], ParentType, ContextType, RequireFields<MutationUploadDocumentPhotoArgs, 'input'>>;
}>;
export type NoPaymentPeriodResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['NoPaymentPeriod'] = ResolversParentTypes['NoPaymentPeriod']> = ResolversObject<{
    endDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    endDateFormatted?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    startDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    startDateFormatted?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    weekCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PdfGenerationResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PDFGenerationResult'] = ResolversParentTypes['PDFGenerationResult']> = ResolversObject<{
    base64?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    filename?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    generatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    url?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PageInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = ResolversObject<{
    endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    hasPreviousPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    startCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PerformanceMetricsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PerformanceMetrics'] = ResolversParentTypes['PerformanceMetrics']> = ResolversObject<{
    activeLoansCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    averageTicket?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    finishedLoansCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    recoveryRate?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PeriodComparisonResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PeriodComparison'] = ResolversParentTypes['PeriodComparison']> = ResolversObject<{
    balanceChange?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    cvChange?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    previousBalance?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    previousClientesActivos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    previousClientesEnCV?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PersonalDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PersonalData'] = ResolversParentTypes['PersonalData']> = ResolversObject<{
    addresses?: Resolver<Array<ResolversTypes['Address']>, ParentType, ContextType>;
    birthDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    borrower?: Resolver<Maybe<ResolversTypes['Borrower']>, ParentType, ContextType>;
    clientCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    employee?: Resolver<Maybe<ResolversTypes['Employee']>, ParentType, ContextType>;
    fullName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    phones?: Resolver<Array<ResolversTypes['Phone']>, ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PhoneResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Phone'] = ResolversParentTypes['Phone']> = ResolversObject<{
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    number?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    personalData?: Resolver<ResolversTypes['PersonalData'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PortfolioCleanupResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PortfolioCleanup'] = ResolversParentTypes['PortfolioCleanup']> = ResolversObject<{
    cleanupDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    excludedAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    excludedLoansCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    executedBy?: Resolver<ResolversTypes['User'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    route?: Resolver<Maybe<ResolversTypes['Route']>, ParentType, ContextType>;
    toDate?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PortfolioReportResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PortfolioReport'] = ResolversParentTypes['PortfolioReport']> = ResolversObject<{
    byLocation?: Resolver<Array<ResolversTypes['LocationBreakdown']>, ParentType, ContextType>;
    month?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    periodType?: Resolver<ResolversTypes['PeriodType'], ParentType, ContextType>;
    renovationKPIs?: Resolver<ResolversTypes['RenovationKPIs'], ParentType, ContextType>;
    reportDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    summary?: Resolver<ResolversTypes['PortfolioSummary'], ParentType, ContextType>;
    weekNumber?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    weeklyData?: Resolver<Array<ResolversTypes['WeeklyPortfolioData']>, ParentType, ContextType>;
    year?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type PortfolioSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PortfolioSummary'] = ResolversParentTypes['PortfolioSummary']> = ResolversObject<{
    clientBalance?: Resolver<ResolversTypes['ClientBalanceData'], ParentType, ContextType>;
    clientesAlCorriente?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesEnCV?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    comparison?: Resolver<Maybe<ResolversTypes['PeriodComparison']>, ParentType, ContextType>;
    promedioCV?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    semanasCompletadas?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    totalClientesActivos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalSemanas?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
    account?: Resolver<Maybe<ResolversTypes['Account']>, ParentType, ContextType, RequireFields<QueryAccountArgs, 'id'>>;
    accounts?: Resolver<Array<ResolversTypes['Account']>, ParentType, ContextType, Partial<QueryAccountsArgs>>;
    activeClientsWithCVStatus?: Resolver<Array<ResolversTypes['ActiveClientStatus']>, ParentType, ContextType, Partial<QueryActiveClientsWithCvStatusArgs>>;
    badDebtByMonth?: Resolver<Array<ResolversTypes['BadDebtData']>, ParentType, ContextType, RequireFields<QueryBadDebtByMonthArgs, 'month' | 'year'>>;
    badDebtSummary?: Resolver<ResolversTypes['BadDebtSummary'], ParentType, ContextType>;
    checkExistingLeader?: Resolver<Maybe<ResolversTypes['ExistingLeaderInfo']>, ParentType, ContextType, RequireFields<QueryCheckExistingLeaderArgs, 'locationId'>>;
    currentActiveWeek?: Resolver<ResolversTypes['WeekRange'], ParentType, ContextType>;
    currentWeek?: Resolver<ResolversTypes['WeekInfo'], ParentType, ContextType>;
    deadDebtLoans?: Resolver<ResolversTypes['DeadDebtQueryResult'], ParentType, ContextType, Partial<QueryDeadDebtLoansArgs>>;
    deadDebtMonthlySummary?: Resolver<ResolversTypes['DeadDebtMonthlySummaryResult'], ParentType, ContextType, RequireFields<QueryDeadDebtMonthlySummaryArgs, 'year'>>;
    deadDebtSummaryByLocality?: Resolver<Array<ResolversTypes['DeadDebtSummaryByLocality']>, ParentType, ContextType, Partial<QueryDeadDebtSummaryByLocalityArgs>>;
    documentNotificationLogs?: Resolver<Array<ResolversTypes['DocumentNotificationLog']>, ParentType, ContextType, Partial<QueryDocumentNotificationLogsArgs>>;
    documentPhoto?: Resolver<Maybe<ResolversTypes['DocumentPhoto']>, ParentType, ContextType, RequireFields<QueryDocumentPhotoArgs, 'id'>>;
    documentPhotos?: Resolver<Array<ResolversTypes['DocumentPhoto']>, ParentType, ContextType, Partial<QueryDocumentPhotosArgs>>;
    documentsWithErrors?: Resolver<Array<ResolversTypes['DocumentPhoto']>, ParentType, ContextType, Partial<QueryDocumentsWithErrorsArgs>>;
    documentsWithNotificationStatus?: Resolver<Array<ResolversTypes['DocumentWithNotificationStatus']>, ParentType, ContextType, Partial<QueryDocumentsWithNotificationStatusArgs>>;
    employee?: Resolver<Maybe<ResolversTypes['Employee']>, ParentType, ContextType, RequireFields<QueryEmployeeArgs, 'id'>>;
    employees?: Resolver<Array<ResolversTypes['Employee']>, ParentType, ContextType, Partial<QueryEmployeesArgs>>;
    financialReport?: Resolver<ResolversTypes['FinancialReport'], ParentType, ContextType, RequireFields<QueryFinancialReportArgs, 'month' | 'routeIds' | 'year'>>;
    getBankIncomeTransactions?: Resolver<ResolversTypes['BankIncomeTransactionsResponse'], ParentType, ContextType, RequireFields<QueryGetBankIncomeTransactionsArgs, 'endDate' | 'routeIds' | 'startDate'>>;
    getClientHistory?: Resolver<ResolversTypes['ClientHistoryData'], ParentType, ContextType, RequireFields<QueryGetClientHistoryArgs, 'clientId'>>;
    getFinancialReportAnnual?: Resolver<ResolversTypes['AnnualFinancialReport'], ParentType, ContextType, RequireFields<QueryGetFinancialReportAnnualArgs, 'routeIds' | 'year'>>;
    leadPaymentReceivedByLeadAndDate?: Resolver<Maybe<ResolversTypes['LeadPaymentReceived']>, ParentType, ContextType, RequireFields<QueryLeadPaymentReceivedByLeadAndDateArgs, 'endDate' | 'leadId' | 'startDate'>>;
    loan?: Resolver<Maybe<ResolversTypes['Loan']>, ParentType, ContextType, RequireFields<QueryLoanArgs, 'id'>>;
    loanPayments?: Resolver<Array<ResolversTypes['LoanPayment']>, ParentType, ContextType, RequireFields<QueryLoanPaymentsArgs, 'loanId'>>;
    loanPaymentsByLeadAndDate?: Resolver<Array<ResolversTypes['LoanPayment']>, ParentType, ContextType, RequireFields<QueryLoanPaymentsByLeadAndDateArgs, 'endDate' | 'leadId' | 'startDate'>>;
    loans?: Resolver<ResolversTypes['LoanConnection'], ParentType, ContextType, Partial<QueryLoansArgs>>;
    loansByWeekAndLocation?: Resolver<Array<ResolversTypes['Loan']>, ParentType, ContextType, RequireFields<QueryLoansByWeekAndLocationArgs, 'weekNumber' | 'year'>>;
    loansForBadDebt?: Resolver<Array<ResolversTypes['Loan']>, ParentType, ContextType, Partial<QueryLoansForBadDebtArgs>>;
    loantype?: Resolver<Maybe<ResolversTypes['Loantype']>, ParentType, ContextType, RequireFields<QueryLoantypeArgs, 'id'>>;
    loantypes?: Resolver<Array<ResolversTypes['Loantype']>, ParentType, ContextType, Partial<QueryLoantypesArgs>>;
    localityClients?: Resolver<Array<ResolversTypes['LocalityClientDetail']>, ParentType, ContextType, RequireFields<QueryLocalityClientsArgs, 'localityId' | 'month' | 'year'>>;
    locations?: Resolver<Array<ResolversTypes['Location']>, ParentType, ContextType, Partial<QueryLocationsArgs>>;
    locationsCreatedInPeriod?: Resolver<Array<ResolversTypes['Location']>, ParentType, ContextType, RequireFields<QueryLocationsCreatedInPeriodArgs, 'fromDate' | 'toDate'>>;
    me?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
    municipalities?: Resolver<Array<ResolversTypes['Municipality']>, ParentType, ContextType>;
    portfolioByLocality?: Resolver<ResolversTypes['LocalityReport'], ParentType, ContextType, RequireFields<QueryPortfolioByLocalityArgs, 'month' | 'year'>>;
    portfolioCleanups?: Resolver<Array<ResolversTypes['PortfolioCleanup']>, ParentType, ContextType, Partial<QueryPortfolioCleanupsArgs>>;
    portfolioReportMonthly?: Resolver<ResolversTypes['PortfolioReport'], ParentType, ContextType, RequireFields<QueryPortfolioReportMonthlyArgs, 'month' | 'year'>>;
    portfolioReportWeekly?: Resolver<ResolversTypes['PortfolioReport'], ParentType, ContextType, RequireFields<QueryPortfolioReportWeeklyArgs, 'weekNumber' | 'year'>>;
    previewPortfolioCleanup?: Resolver<ResolversTypes['CleanupPreview'], ParentType, ContextType, RequireFields<QueryPreviewPortfolioCleanupArgs, 'maxSignDate'>>;
    recoveredDeadDebt?: Resolver<ResolversTypes['RecoveredDeadDebtResult'], ParentType, ContextType, RequireFields<QueryRecoveredDeadDebtArgs, 'month' | 'year'>>;
    reportConfig?: Resolver<Maybe<ResolversTypes['ReportConfig']>, ParentType, ContextType, RequireFields<QueryReportConfigArgs, 'id'>>;
    reportConfigs?: Resolver<Array<ResolversTypes['ReportConfig']>, ParentType, ContextType, Partial<QueryReportConfigsArgs>>;
    reportExecutionLogs?: Resolver<Array<ResolversTypes['ReportExecutionLog']>, ParentType, ContextType, Partial<QueryReportExecutionLogsArgs>>;
    route?: Resolver<Maybe<ResolversTypes['Route']>, ParentType, ContextType, RequireFields<QueryRouteArgs, 'id'>>;
    routes?: Resolver<Array<ResolversTypes['Route']>, ParentType, ContextType>;
    routesWithStats?: Resolver<Array<ResolversTypes['RouteWithStats']>, ParentType, ContextType, RequireFields<QueryRoutesWithStatsArgs, 'month' | 'year'>>;
    searchBorrowers?: Resolver<Array<ResolversTypes['BorrowerSearchResult']>, ParentType, ContextType, RequireFields<QuerySearchBorrowersArgs, 'searchTerm'>>;
    searchClients?: Resolver<Array<ResolversTypes['ClientSearchResult']>, ParentType, ContextType, RequireFields<QuerySearchClientsArgs, 'searchTerm'>>;
    searchPersonalData?: Resolver<Array<ResolversTypes['PersonalData']>, ParentType, ContextType, RequireFields<QuerySearchPersonalDataArgs, 'searchTerm'>>;
    telegramUser?: Resolver<Maybe<ResolversTypes['TelegramUser']>, ParentType, ContextType, RequireFields<QueryTelegramUserArgs, 'id'>>;
    telegramUserByChatId?: Resolver<Maybe<ResolversTypes['TelegramUser']>, ParentType, ContextType, RequireFields<QueryTelegramUserByChatIdArgs, 'chatId'>>;
    telegramUserStats?: Resolver<ResolversTypes['TelegramUserStats'], ParentType, ContextType>;
    telegramUsers?: Resolver<Array<ResolversTypes['TelegramUser']>, ParentType, ContextType, Partial<QueryTelegramUsersArgs>>;
    transactions?: Resolver<ResolversTypes['TransactionConnection'], ParentType, ContextType, Partial<QueryTransactionsArgs>>;
    user?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType, RequireFields<QueryUserArgs, 'id'>>;
    users?: Resolver<Array<ResolversTypes['User']>, ParentType, ContextType, Partial<QueryUsersArgs>>;
}>;
export type RecoveredDeadDebtPaymentResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RecoveredDeadDebtPayment'] = ResolversParentTypes['RecoveredDeadDebtPayment']> = ResolversObject<{
    amount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    badDebtDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    clientCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    clientName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    loanId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    locality?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    pendingAmount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    receivedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    routeName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type RecoveredDeadDebtResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RecoveredDeadDebtResult'] = ResolversParentTypes['RecoveredDeadDebtResult']> = ResolversObject<{
    month?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    payments?: Resolver<Array<ResolversTypes['RecoveredDeadDebtPayment']>, ParentType, ContextType>;
    summary?: Resolver<ResolversTypes['RecoveredDeadDebtSummary'], ParentType, ContextType>;
    year?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type RecoveredDeadDebtSummaryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RecoveredDeadDebtSummary'] = ResolversParentTypes['RecoveredDeadDebtSummary']> = ResolversObject<{
    clientsCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    loansCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    paymentsCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalRecovered?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type RenovationKpIsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RenovationKPIs'] = ResolversParentTypes['RenovationKPIs']> = ResolversObject<{
    tasaRenovacion?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    tendencia?: Resolver<ResolversTypes['Trend'], ParentType, ContextType>;
    totalCierresSinRenovar?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalRenovaciones?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ReportConfigResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReportConfig'] = ResolversParentTypes['ReportConfig']> = ResolversObject<{
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    executionLogs?: Resolver<Array<ResolversTypes['ReportExecutionLog']>, ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    reportType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    routes?: Resolver<Array<ResolversTypes['Route']>, ParentType, ContextType>;
    schedule?: Resolver<Maybe<ResolversTypes['ReportSchedule']>, ParentType, ContextType>;
    telegramRecipients?: Resolver<Array<ResolversTypes['TelegramUser']>, ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ReportExecutionLogResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReportExecutionLog'] = ResolversParentTypes['ReportExecutionLog']> = ResolversObject<{
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    cronExpression?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    duration?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    endTime?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
    errorDetails?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    executionType?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    failedDeliveries?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    message?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    recipientsCount?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    reportConfig?: Resolver<ResolversTypes['ReportConfig'], ParentType, ContextType>;
    startTime?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    successfulDeliveries?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
    timezone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ReportExecutionResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReportExecutionResult'] = ResolversParentTypes['ReportExecutionResult']> = ResolversObject<{
    errors?: Resolver<Maybe<Array<ResolversTypes['String']>>, ParentType, ContextType>;
    message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    recipientsNotified?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type ReportScheduleResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ReportSchedule'] = ResolversParentTypes['ReportSchedule']> = ResolversObject<{
    days?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
    hour?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    timezone?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type RouteResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Route'] = ResolversParentTypes['Route']> = ResolversObject<{
    accounts?: Resolver<Array<ResolversTypes['Account']>, ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    employees?: Resolver<Array<ResolversTypes['Employee']>, ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    locations?: Resolver<Array<ResolversTypes['Location']>, ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    transactions?: Resolver<Array<ResolversTypes['Transaction']>, ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type RouteInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RouteInfo'] = ResolversParentTypes['RouteInfo']> = ResolversObject<{
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type RouteWithStatsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RouteWithStats'] = ResolversParentTypes['RouteWithStats']> = ResolversObject<{
    alCorriente?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    employees?: Resolver<Array<ResolversTypes['EmployeeWithStats']>, ParentType, ContextType>;
    enCV?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    routeId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    routeName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    totalActivos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type SendNotificationResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['SendNotificationResult'] = ResolversParentTypes['SendNotificationResult']> = ResolversObject<{
    message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    notificationId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
    success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    telegramResponse?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type StateResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['State'] = ResolversParentTypes['State']> = ResolversObject<{
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    municipalities?: Resolver<Array<ResolversTypes['Municipality']>, ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type TelegramUserResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TelegramUser'] = ResolversParentTypes['TelegramUser']> = ResolversObject<{
    chatId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    isActive?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    isInRecipientsList?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    lastActivity?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    notes?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    platformUser?: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType>;
    registeredAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    reportConfigs?: Resolver<Array<ResolversTypes['ReportConfig']>, ParentType, ContextType>;
    reportsReceived?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    username?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type TelegramUserStatsResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TelegramUserStats'] = ResolversParentTypes['TelegramUserStats']> = ResolversObject<{
    activeUsers?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    inRecipientsList?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    inactiveUsers?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    linkedToPlataform?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    totalUsers?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type TransactionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Transaction'] = ResolversParentTypes['Transaction']> = ResolversObject<{
    amount?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    date?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    destinationAccount?: Resolver<Maybe<ResolversTypes['Account']>, ParentType, ContextType>;
    expenseSource?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    incomeSource?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
    lead?: Resolver<Maybe<ResolversTypes['Employee']>, ParentType, ContextType>;
    loan?: Resolver<Maybe<ResolversTypes['Loan']>, ParentType, ContextType>;
    loanPayment?: Resolver<Maybe<ResolversTypes['LoanPayment']>, ParentType, ContextType>;
    profitAmount?: Resolver<Maybe<ResolversTypes['Decimal']>, ParentType, ContextType>;
    returnToCapital?: Resolver<Maybe<ResolversTypes['Decimal']>, ParentType, ContextType>;
    route?: Resolver<Maybe<ResolversTypes['Route']>, ParentType, ContextType>;
    sourceAccount?: Resolver<ResolversTypes['Account'], ParentType, ContextType>;
    type?: Resolver<ResolversTypes['TransactionType'], ParentType, ContextType>;
    updatedAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type TransactionConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TransactionConnection'] = ResolversParentTypes['TransactionConnection']> = ResolversObject<{
    edges?: Resolver<Array<ResolversTypes['TransactionEdge']>, ParentType, ContextType>;
    pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
    totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type TransactionEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['TransactionEdge'] = ResolversParentTypes['TransactionEdge']> = ResolversObject<{
    cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    node?: Resolver<ResolversTypes['Transaction'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export interface UploadScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Upload'], any> {
    name: 'Upload';
}
export type UserResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User']> = ResolversObject<{
    createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    employee?: Resolver<Maybe<ResolversTypes['Employee']>, ParentType, ContextType>;
    id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
    name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
    role?: Resolver<ResolversTypes['UserRole'], ParentType, ContextType>;
    telegramUser?: Resolver<Maybe<ResolversTypes['TelegramUser']>, ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type WeekInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['WeekInfo'] = ResolversParentTypes['WeekInfo']> = ResolversObject<{
    endDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    startDate?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    weekNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    year?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type WeekRangeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['WeekRange'] = ResolversParentTypes['WeekRange']> = ResolversObject<{
    end?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    start?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    weekNumber?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    year?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type WeeklyDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['WeeklyData'] = ResolversParentTypes['WeeklyData']> = ResolversObject<{
    date?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
    expectedPayments?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    loansGranted?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    paymentsCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    paymentsReceived?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    recoveryRate?: Resolver<ResolversTypes['Decimal'], ParentType, ContextType>;
    week?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type WeeklyPortfolioDataResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['WeeklyPortfolioData'] = ResolversParentTypes['WeeklyPortfolioData']> = ResolversObject<{
    balance?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesActivos?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    clientesEnCV?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
    isCompleted?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
    weekRange?: Resolver<ResolversTypes['WeekRange'], ParentType, ContextType>;
    __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;
export type Resolvers<ContextType = GraphQLContext> = ResolversObject<{
    Account?: AccountResolvers<ContextType>;
    ActiveClientStatus?: ActiveClientStatusResolvers<ContextType>;
    ActiveLoansBreakdown?: ActiveLoansBreakdownResolvers<ContextType>;
    Address?: AddressResolvers<ContextType>;
    AnnualFinancialReport?: AnnualFinancialReportResolvers<ContextType>;
    AuthPayload?: AuthPayloadResolvers<ContextType>;
    BadDebtData?: BadDebtDataResolvers<ContextType>;
    BadDebtSummary?: BadDebtSummaryResolvers<ContextType>;
    BankIncomeTransaction?: BankIncomeTransactionResolvers<ContextType>;
    BankIncomeTransactionsResponse?: BankIncomeTransactionsResponseResolvers<ContextType>;
    BatchTransferResult?: BatchTransferResultResolvers<ContextType>;
    Borrower?: BorrowerResolvers<ContextType>;
    BorrowerSearchResult?: BorrowerSearchResultResolvers<ContextType>;
    CleanupLoanPreview?: CleanupLoanPreviewResolvers<ContextType>;
    CleanupPreview?: CleanupPreviewResolvers<ContextType>;
    ClientAddressInfo?: ClientAddressInfoResolvers<ContextType>;
    ClientBalanceData?: ClientBalanceDataResolvers<ContextType>;
    ClientHistoryData?: ClientHistoryDataResolvers<ContextType>;
    ClientInfo?: ClientInfoResolvers<ContextType>;
    ClientSearchResult?: ClientSearchResultResolvers<ContextType>;
    ClientSummary?: ClientSummaryResolvers<ContextType>;
    CommissionPayment?: CommissionPaymentResolvers<ContextType>;
    ComparisonData?: ComparisonDataResolvers<ContextType>;
    CreateNewLeaderResult?: CreateNewLeaderResultResolvers<ContextType>;
    DateTime?: GraphQLScalarType;
    DeadDebtBorrower?: DeadDebtBorrowerResolvers<ContextType>;
    DeadDebtCriteria?: DeadDebtCriteriaResolvers<ContextType>;
    DeadDebtLead?: DeadDebtLeadResolvers<ContextType>;
    DeadDebtLoan?: DeadDebtLoanResolvers<ContextType>;
    DeadDebtMonthSummary?: DeadDebtMonthSummaryResolvers<ContextType>;
    DeadDebtMonthlySummaryResult?: DeadDebtMonthlySummaryResultResolvers<ContextType>;
    DeadDebtPayment?: DeadDebtPaymentResolvers<ContextType>;
    DeadDebtQueryResult?: DeadDebtQueryResultResolvers<ContextType>;
    DeadDebtSummaryByLocality?: DeadDebtSummaryByLocalityResolvers<ContextType>;
    DeadDebtTotals?: DeadDebtTotalsResolvers<ContextType>;
    Decimal?: GraphQLScalarType;
    DocumentNotificationLog?: DocumentNotificationLogResolvers<ContextType>;
    DocumentPhoto?: DocumentPhotoResolvers<ContextType>;
    DocumentWithNotificationStatus?: DocumentWithNotificationStatusResolvers<ContextType>;
    Employee?: EmployeeResolvers<ContextType>;
    EmployeeWithStats?: EmployeeWithStatsResolvers<ContextType>;
    EvaluationPeriod?: EvaluationPeriodResolvers<ContextType>;
    ExistingLeaderInfo?: ExistingLeaderInfoResolvers<ContextType>;
    FinancialReport?: FinancialReportResolvers<ContextType>;
    FinancialSummary?: FinancialSummaryResolvers<ContextType>;
    JSON?: GraphQLScalarType;
    LeadPaymentReceived?: LeadPaymentReceivedResolvers<ContextType>;
    LeaderInfo?: LeaderInfoResolvers<ContextType>;
    Loan?: LoanResolvers<ContextType>;
    LoanConnection?: LoanConnectionResolvers<ContextType>;
    LoanEdge?: LoanEdgeResolvers<ContextType>;
    LoanHistoryDetail?: LoanHistoryDetailResolvers<ContextType>;
    LoanPayment?: LoanPaymentResolvers<ContextType>;
    LoanPaymentDetail?: LoanPaymentDetailResolvers<ContextType>;
    Loantype?: LoantypeResolvers<ContextType>;
    LocalityBreakdownDetail?: LocalityBreakdownDetailResolvers<ContextType>;
    LocalityClientDetail?: LocalityClientDetailResolvers<ContextType>;
    LocalityReport?: LocalityReportResolvers<ContextType>;
    LocalitySummary?: LocalitySummaryResolvers<ContextType>;
    LocalityWeekData?: LocalityWeekDataResolvers<ContextType>;
    Location?: LocationResolvers<ContextType>;
    LocationBreakdown?: LocationBreakdownResolvers<ContextType>;
    MarkDeadDebtResult?: MarkDeadDebtResultResolvers<ContextType>;
    MonthInfo?: MonthInfoResolvers<ContextType>;
    MonthlyFinancialData?: MonthlyFinancialDataResolvers<ContextType>;
    Municipality?: MunicipalityResolvers<ContextType>;
    Mutation?: MutationResolvers<ContextType>;
    NoPaymentPeriod?: NoPaymentPeriodResolvers<ContextType>;
    PDFGenerationResult?: PdfGenerationResultResolvers<ContextType>;
    PageInfo?: PageInfoResolvers<ContextType>;
    PerformanceMetrics?: PerformanceMetricsResolvers<ContextType>;
    PeriodComparison?: PeriodComparisonResolvers<ContextType>;
    PersonalData?: PersonalDataResolvers<ContextType>;
    Phone?: PhoneResolvers<ContextType>;
    PortfolioCleanup?: PortfolioCleanupResolvers<ContextType>;
    PortfolioReport?: PortfolioReportResolvers<ContextType>;
    PortfolioSummary?: PortfolioSummaryResolvers<ContextType>;
    Query?: QueryResolvers<ContextType>;
    RecoveredDeadDebtPayment?: RecoveredDeadDebtPaymentResolvers<ContextType>;
    RecoveredDeadDebtResult?: RecoveredDeadDebtResultResolvers<ContextType>;
    RecoveredDeadDebtSummary?: RecoveredDeadDebtSummaryResolvers<ContextType>;
    RenovationKPIs?: RenovationKpIsResolvers<ContextType>;
    ReportConfig?: ReportConfigResolvers<ContextType>;
    ReportExecutionLog?: ReportExecutionLogResolvers<ContextType>;
    ReportExecutionResult?: ReportExecutionResultResolvers<ContextType>;
    ReportSchedule?: ReportScheduleResolvers<ContextType>;
    Route?: RouteResolvers<ContextType>;
    RouteInfo?: RouteInfoResolvers<ContextType>;
    RouteWithStats?: RouteWithStatsResolvers<ContextType>;
    SendNotificationResult?: SendNotificationResultResolvers<ContextType>;
    State?: StateResolvers<ContextType>;
    TelegramUser?: TelegramUserResolvers<ContextType>;
    TelegramUserStats?: TelegramUserStatsResolvers<ContextType>;
    Transaction?: TransactionResolvers<ContextType>;
    TransactionConnection?: TransactionConnectionResolvers<ContextType>;
    TransactionEdge?: TransactionEdgeResolvers<ContextType>;
    Upload?: GraphQLScalarType;
    User?: UserResolvers<ContextType>;
    WeekInfo?: WeekInfoResolvers<ContextType>;
    WeekRange?: WeekRangeResolvers<ContextType>;
    WeeklyData?: WeeklyDataResolvers<ContextType>;
    WeeklyPortfolioData?: WeeklyPortfolioDataResolvers<ContextType>;
}>;
export type DirectiveResolvers<ContextType = GraphQLContext> = ResolversObject<{
    auth?: AuthDirectiveResolver<any, any, ContextType>;
    requireRole?: RequireRoleDirectiveResolver<any, any, ContextType>;
}>;
//# sourceMappingURL=types.d.ts.map
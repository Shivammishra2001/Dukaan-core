import type { Schema, Struct } from '@strapi/strapi';

export interface AdminApiToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_tokens';
  info: {
    description: '';
    displayName: 'Api Token';
    name: 'Api Token';
    pluralName: 'api-tokens';
    singularName: 'api-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    adminPermissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::permission'
    >;
    adminUserOwner: Schema.Attribute.Relation<'manyToOne', 'admin::user'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    encryptedKey: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    expiresAt: Schema.Attribute.DateTime;
    kind: Schema.Attribute.Enumeration<['content-api', 'admin']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'content-api'>;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.Enumeration<['read-only', 'full-access', 'custom']> &
      Schema.Attribute.DefaultTo<'read-only'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminApiTokenPermission extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_token_permissions';
  info: {
    description: '';
    displayName: 'API Token Permission';
    name: 'API Token Permission';
    pluralName: 'api-token-permissions';
    singularName: 'api-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminPermission extends Struct.CollectionTypeSchema {
  collectionName: 'admin_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'Permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    actionParameters: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    apiToken: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    conditions: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::permission'> &
      Schema.Attribute.Private;
    properties: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<'manyToOne', 'admin::role'>;
    subject: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminRole extends Struct.CollectionTypeSchema {
  collectionName: 'admin_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'Role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::role'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<'oneToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<'manyToMany', 'admin::user'>;
  };
}

export interface AdminSession extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_sessions';
  info: {
    description: 'Session Manager storage';
    displayName: 'Session';
    name: 'Session';
    pluralName: 'sessions';
    singularName: 'session';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    absoluteExpiresAt: Schema.Attribute.DateTime & Schema.Attribute.Private;
    childId: Schema.Attribute.String & Schema.Attribute.Private;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deviceId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::session'> &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON & Schema.Attribute.Private;
    origin: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    sessionId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique;
    status: Schema.Attribute.String & Schema.Attribute.Private;
    type: Schema.Attribute.String & Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_tokens';
  info: {
    description: '';
    displayName: 'Transfer Token';
    name: 'Transfer Token';
    pluralName: 'transfer-tokens';
    singularName: 'transfer-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferTokenPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_token_permissions';
  info: {
    description: '';
    displayName: 'Transfer Token Permission';
    name: 'Transfer Token Permission';
    pluralName: 'transfer-token-permissions';
    singularName: 'transfer-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::transfer-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminUser extends Struct.CollectionTypeSchema {
  collectionName: 'admin_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'User';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    apiTokens: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    blocked: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    firstname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    lastname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::user'> &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    preferedLanguage: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    registrationToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordTokenExpiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Private;
    roles: Schema.Attribute.Relation<'manyToMany', 'admin::role'> &
      Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String;
  };
}

export interface ApiAppUserStoreRoleAppUserStoreRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'app_user_store_roles';
  info: {
    description: "DATABASE_SCHEMA.md \u00A72.5 `app_user_store_roles` \u2014 grants one app_user a role within one store. A user with rows across multiple stores can hold different roles per store without a separate login. Written directly via Knex inside src/api/auth/services/auth.ts's registration/onboarding transaction (Rule BE-2 / ADR-04 pattern), same as onboardStoreCore.";
    displayName: 'App User Store Role';
    pluralName: 'app-user-store-roles';
    singularName: 'app-user-store-role';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::app-user-store-role.app-user-store-role'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<'manyToOne', 'api::role.role'> &
      Schema.Attribute.Required;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<'manyToOne', 'api::app-user.app-user'> &
      Schema.Attribute.Required;
  };
}

export interface ApiAppUserAppUser extends Struct.CollectionTypeSchema {
  collectionName: 'app_users';
  info: {
    description: "DATABASE_SCHEMA.md \u00A72.5. Extended for the Tenant Onboarding / Auth milestone with phone, password_hash and store_roles \u2014 see src/api/auth/services/auth.ts. `pin_hash`/PIN-login (TEN-004) is documented but out of this milestone's scope.";
    displayName: 'App User';
    pluralName: 'app-users';
    singularName: 'app-user';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email;
    full_name: Schema.Attribute.String & Schema.Attribute.Required;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    last_login_at: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::app-user.app-user'
    > &
      Schema.Attribute.Private;
    password_hash: Schema.Attribute.String & Schema.Attribute.Private;
    phone: Schema.Attribute.String &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 15;
      }>;
    pin_hash: Schema.Attribute.String & Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    store_roles: Schema.Attribute.Relation<
      'oneToMany',
      'api::app-user-store-role.app-user-store-role'
    >;
    tenant: Schema.Attribute.Relation<'manyToOne', 'api::tenant.tenant'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiB2BOrderItemB2BOrderItem
  extends Struct.CollectionTypeSchema {
  collectionName: 'b2b_order_items';
  info: {
    description: 'Milestone 6 addition \u2014 see b2b-order/content-types/b2b-order/schema.json.';
    displayName: 'B2B Order Item';
    pluralName: 'b2b-order-items';
    singularName: 'b2b-order-item';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    b2b_order: Schema.Attribute.Relation<
      'manyToOne',
      'api::b2b-order.b2b-order'
    > &
      Schema.Attribute.Required;
    batch: Schema.Attribute.Relation<
      'manyToOne',
      'api::inventory-batch.inventory-batch'
    >;
    cgst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    conversion_factor: Schema.Attribute.Decimal & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entered_qty: Schema.Attribute.Decimal & Schema.Attribute.Required;
    entered_unit: Schema.Attribute.String & Schema.Attribute.Required;
    gst_rate: Schema.Attribute.Decimal & Schema.Attribute.Required;
    igst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    line_total_paise: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::b2b-order-item.b2b-order-item'
    > &
      Schema.Attribute.Private;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    qty_base: Schema.Attribute.Decimal & Schema.Attribute.Required;
    sgst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    taxable_value_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required;
    unit_price_paise: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiB2BOrderB2BOrder extends Struct.CollectionTypeSchema {
  collectionName: 'b2b_orders';
  info: {
    description: "Milestone 6 addition \u2014 no schema for this exists in DATABASE_SCHEMA.md (see backend/README.md). A wholesale order booked by phone/sales-rep, going through BOOKED -> DISPATCHED -> DELIVERED rather than the retail POS's instant checkout.service.ts. Deliberately its own table, not the `orders`/`order_items` retail tables \u2014 reads/writes the same `inventory_batches` pool as POS (Part 4's requirement) but keeps a hard boundary from the verified checkout flow (zero breaking changes). Read-only via the Content API \u2014 all writes go through b2b-dispatch.service.ts.";
    displayName: 'B2B Order';
    pluralName: 'b2b-orders';
    singularName: 'b2b-order';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    booked_at: Schema.Attribute.DateTime & Schema.Attribute.Required;
    business_date: Schema.Attribute.Date & Schema.Attribute.Required;
    challan_no: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 30;
      }>;
    client_uuid: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    customer: Schema.Attribute.Relation<'manyToOne', 'api::customer.customer'> &
      Schema.Attribute.Required;
    delivered_at: Schema.Attribute.DateTime;
    dispatched_at: Schema.Attribute.DateTime;
    driver_name: Schema.Attribute.String;
    freight_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.DefaultTo<'0'>;
    freight_terms: Schema.Attribute.Enumeration<
      ['PAID_BY_STORE', 'TO_PAY_BY_CUSTOMER']
    > &
      Schema.Attribute.DefaultTo<'PAID_BY_STORE'>;
    invoice_no: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    items: Schema.Attribute.Relation<
      'oneToMany',
      'api::b2b-order-item.b2b-order-item'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::b2b-order.b2b-order'
    > &
      Schema.Attribute.Private;
    note: Schema.Attribute.Text;
    publishedAt: Schema.Attribute.DateTime;
    round_off_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    route: Schema.Attribute.String;
    status: Schema.Attribute.Enumeration<
      ['BOOKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'BOOKED'>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    subtotal_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    tax_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    total_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    transporter: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    vehicle_no: Schema.Attribute.String;
  };
}

export interface ApiCategoryCategory extends Struct.CollectionTypeSchema {
  collectionName: 'categories';
  info: {
    description: 'Minimal stub \u2014 included only because product.category is a relation in DATABASE_SCHEMA.md \u00A73.2. Full category management is out of Milestone 1 scope.';
    displayName: 'Category';
    pluralName: 'categories';
    singularName: 'category';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    children: Schema.Attribute.Relation<'oneToMany', 'api::category.category'>;
    color_hex: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 7;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::category.category'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    name_local: Schema.Attribute.String;
    parent: Schema.Attribute.Relation<'manyToOne', 'api::category.category'>;
    products: Schema.Attribute.Relation<'oneToMany', 'api::product.product'>;
    publishedAt: Schema.Attribute.DateTime;
    sort_order: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCounterCounter extends Struct.CollectionTypeSchema {
  collectionName: 'counters';
  info: {
    description: 'DATABASE_SCHEMA.md \u00A72.4. Added in Milestone 3 because orders.counter_id references it.';
    displayName: 'Counter';
    pluralName: 'counters';
    singularName: 'counter';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 10;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::counter.counter'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiCustomerCustomer extends Struct.CollectionTypeSchema {
  collectionName: 'customers';
  info: {
    description: 'DATABASE_SCHEMA.md \u00A76.1. No plaintext phone/address attribute exists by design \u2014 see src/api/customer/services/pii-crypto.ts. Callers submit plaintext phone/address only to the custom controller actions, which encrypt before persisting.';
    displayName: 'Customer';
    pluralName: 'customers';
    singularName: 'customer';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    address_enc: Schema.Attribute.Text;
    client_uuid: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    credit_days: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<30>;
    credit_limit_enabled: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    credit_limit_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: '0';
        },
        string
      > &
      Schema.Attribute.DefaultTo<'0'>;
    current_balance_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    gstin: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 15;
      }>;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    last_txn_at: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::customer.customer'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    name_local: Schema.Attribute.String;
    opening_balance_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    phone_enc: Schema.Attribute.Text;
    phone_hash: Schema.Attribute.String;
    phone_last4: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 4;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    state_code: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2;
        minLength: 2;
      }>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    tags: Schema.Attribute.JSON;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiInventoryBatchInventoryBatch
  extends Struct.CollectionTypeSchema {
  collectionName: 'inventory_batches';
  info: {
    description: "DATABASE_SCHEMA.md \u00A74.1. FEFO allocation (REQUIREMENTS.md \u00A73.2) reads this table under row locks; partial/FEFO indexes are added by migration since Strapi's schema builder cannot express conditional indexes.";
    displayName: 'Inventory Batch';
    pluralName: 'inventory-batches';
    singularName: 'inventory-batch';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    batch_no: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }> &
      Schema.Attribute.DefaultTo<'DEFAULT'>;
    cost_price_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    current_stock_base: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    expiry_date: Schema.Attribute.Date;
    landed_cost_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::inventory-batch.inventory-batch'
    > &
      Schema.Attribute.Private;
    mfg_date: Schema.Attribute.Date;
    mrp_paise: Schema.Attribute.BigInteger;
    opening_stock_base: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    received_at: Schema.Attribute.DateTime & Schema.Attribute.Required;
    reserved_base: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    selling_price_paise: Schema.Attribute.BigInteger;
    source_bill_item_id: Schema.Attribute.BigInteger;
    status: Schema.Attribute.Enumeration<
      ['ACTIVE', 'QUARANTINE', 'WRITTEN_OFF', 'CLOSED']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'ACTIVE'>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiOrderItemOrderItem extends Struct.CollectionTypeSchema {
  collectionName: 'order_items';
  info: {
    description: "DATABASE_SCHEMA.md \u00A75.4. One row per batch allocation (Rule FEFO-1). No standalone controllers/routes \u2014 never mutated outside checkout.service's transaction, and only ever read via order.items.";
    displayName: 'Order Item';
    pluralName: 'order-items';
    singularName: 'order-item';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    base_unit: Schema.Attribute.Enumeration<['G', 'ML', 'PCS']> &
      Schema.Attribute.Required;
    batch: Schema.Attribute.Relation<
      'manyToOne',
      'api::inventory-batch.inventory-batch'
    >;
    batch_no: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    cart_discount_share_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cess_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cgst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    conversion_factor: Schema.Attribute.Decimal & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entered_qty: Schema.Attribute.Decimal & Schema.Attribute.Required;
    entered_unit: Schema.Attribute.String & Schema.Attribute.Required;
    expiry_date: Schema.Attribute.Date;
    gross_paise: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    gst_rate: Schema.Attribute.Decimal & Schema.Attribute.Required;
    hsn_code: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 8;
      }>;
    igst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    line_cogs_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    line_discount_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    line_group_id: Schema.Attribute.String & Schema.Attribute.Required;
    line_no: Schema.Attribute.Integer & Schema.Attribute.Required;
    line_total_paise: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::order-item.order-item'
    > &
      Schema.Attribute.Private;
    mrp_paise: Schema.Attribute.BigInteger;
    note: Schema.Attribute.Text;
    order: Schema.Attribute.Relation<'manyToOne', 'api::order.order'> &
      Schema.Attribute.Required;
    price_source: Schema.Attribute.Enumeration<
      ['PRODUCT', 'BATCH', 'UNIT_OVERRIDE', 'MANUAL']
    > &
      Schema.Attribute.Required;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'> &
      Schema.Attribute.Required;
    product_name: Schema.Attribute.String & Schema.Attribute.Required;
    product_name_local: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    qty_base: Schema.Attribute.Decimal & Schema.Attribute.Required;
    returned_qty_base: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    sgst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    tax_inclusive: Schema.Attribute.Boolean & Schema.Attribute.Required;
    taxable_value_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required;
    unit_cost_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    unit_price_paise: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiOrderPaymentOrderPayment
  extends Struct.CollectionTypeSchema {
  collectionName: 'order_payments';
  info: {
    description: "DATABASE_SCHEMA.md \u00A75.5. No standalone controllers/routes \u2014 written only inside checkout.service's transaction.";
    displayName: 'Order Payment';
    pluralName: 'order-payments';
    singularName: 'order-payment';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    amount_paise: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    change_paise: Schema.Attribute.BigInteger;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::order-payment.order-payment'
    > &
      Schema.Attribute.Private;
    method: Schema.Attribute.Enumeration<
      ['CASH', 'CARD', 'UPI', 'WALLET', 'CREDIT', 'BANK_TRANSFER', 'CHEQUE']
    > &
      Schema.Attribute.Required;
    order: Schema.Attribute.Relation<'manyToOne', 'api::order.order'> &
      Schema.Attribute.Required;
    provider: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    reference: Schema.Attribute.String;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    tendered_paise: Schema.Attribute.BigInteger;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiOrderOrder extends Struct.CollectionTypeSchema {
  collectionName: 'orders';
  info: {
    description: "DATABASE_SCHEMA.md \u00A75.3. Read-only via the Content API (routes/order.ts disables create/update/delete) \u2014 all writes happen inside checkout.service's Knex transaction. device_id is omitted: device management is out of scope (no device-registration flow), and it's nullable in the spec. shift was added in Milestone 4 (see shift content type).";
    displayName: 'Order';
    pluralName: 'orders';
    singularName: 'order';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    business_date: Schema.Attribute.Date & Schema.Attribute.Required;
    cart_discount_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cashier: Schema.Attribute.Relation<'manyToOne', 'api::app-user.app-user'> &
      Schema.Attribute.Required;
    cess_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cgst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    charges_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    client_created_at: Schema.Attribute.DateTime;
    client_uuid: Schema.Attribute.String & Schema.Attribute.Required;
    cogs_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    counter: Schema.Attribute.Relation<'manyToOne', 'api::counter.counter'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    credit_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    customer: Schema.Attribute.Relation<'manyToOne', 'api::customer.customer'>;
    financial_year: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 7;
      }>;
    gross_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    igst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    invoice_no: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    is_offline_origin: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    items: Schema.Attribute.Relation<'oneToMany', 'api::order-item.order-item'>;
    line_discount_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::order.order'> &
      Schema.Attribute.Private;
    note: Schema.Attribute.Text;
    order_type: Schema.Attribute.Enumeration<['SALE', 'RETURN', 'EXCHANGE']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SALE'>;
    original_order: Schema.Attribute.Relation<'manyToOne', 'api::order.order'>;
    paid_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    payments: Schema.Attribute.Relation<
      'oneToMany',
      'api::order-payment.order-payment'
    >;
    print_count: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    provisional_no: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    round_off_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    server_created_at: Schema.Attribute.DateTime & Schema.Attribute.Required;
    settlement_status: Schema.Attribute.Enumeration<
      ['SETTLED', 'PARTIALLY_SETTLED', 'UNPAID']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'SETTLED'>;
    sgst_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    shift: Schema.Attribute.Relation<'manyToOne', 'api::shift.shift'>;
    status: Schema.Attribute.Enumeration<
      ['DRAFT', 'COMPLETED', 'CANCELLED', 'PARTIALLY_RETURNED', 'RETURNED']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'COMPLETED'>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    supply_type: Schema.Attribute.Enumeration<['INTRA_STATE', 'INTER_STATE']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'INTRA_STATE'>;
    taxable_value_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    total_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiProductProduct extends Struct.CollectionTypeSchema {
  collectionName: 'products';
  info: {
    description: 'DATABASE_SCHEMA.md \u00A73.2. Note: product_barcodes is out of Milestone 1 scope, so the `barcodes` relation is omitted here (it is additive and can be added later without touching this schema).';
    displayName: 'Product';
    pluralName: 'products';
    singularName: 'product';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    allow_fractional: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    base_unit: Schema.Attribute.Enumeration<['G', 'ML', 'PCS']> &
      Schema.Attribute.Required;
    batches: Schema.Attribute.Relation<
      'oneToMany',
      'api::inventory-batch.inventory-batch'
    >;
    category: Schema.Attribute.Relation<'manyToOne', 'api::category.category'>;
    cess_rate: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    default_purchase_unit: Schema.Attribute.String & Schema.Attribute.Required;
    default_sale_unit: Schema.Attribute.String & Schema.Attribute.Required;
    discount_exempt: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    gst_rate: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    hsn_code: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 8;
      }>;
    image_url: Schema.Attribute.String;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    is_service: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    last_cost_paise: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::product.product'
    > &
      Schema.Attribute.Private;
    mrp_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.SetMinMax<
        {
          min: '0';
        },
        string
      >;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    name_local: Schema.Attribute.String;
    pricing_unit: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    quantity_precision: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 3;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    reorder_level_base: Schema.Attribute.Decimal;
    reorder_qty_base: Schema.Attribute.Decimal;
    requires_quantity_prompt: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    sales_rank: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    search_text: Schema.Attribute.Text;
    sell_rate_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: '0';
        },
        string
      >;
    sku: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    tax_inclusive: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    track_batches: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    track_expiry: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    unit_conversions: Schema.Attribute.Relation<
      'oneToMany',
      'api::unit-conversion.unit-conversion'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    wholesale_tier1_rate_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.SetMinMax<
        {
          min: '0';
        },
        string
      >;
    wholesale_tier2_rate_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.SetMinMax<
        {
          min: '0';
        },
        string
      >;
  };
}

export interface ApiPurchaseBillItemPurchaseBillItem
  extends Struct.CollectionTypeSchema {
  collectionName: 'purchase_bill_items';
  info: {
    description: 'DATABASE_SCHEMA.md \u00A77.3.';
    displayName: 'Purchase Bill Item';
    pluralName: 'purchase-bill-items';
    singularName: 'purchase-bill-item';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    batch: Schema.Attribute.Relation<
      'manyToOne',
      'api::inventory-batch.inventory-batch'
    >;
    batch_no: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    conversion_factor: Schema.Attribute.Decimal & Schema.Attribute.Required;
    cost_per_base_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required;
    cost_rate_paise: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    discount_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    expiry_date: Schema.Attribute.Date;
    free_qty_base: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    freight_share_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    gst_rate: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    landed_cost_per_base_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    line_total_paise: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::purchase-bill-item.purchase-bill-item'
    > &
      Schema.Attribute.Private;
    mfg_date: Schema.Attribute.Date;
    mrp_paise: Schema.Attribute.BigInteger;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    purchase_bill: Schema.Attribute.Relation<
      'manyToOne',
      'api::purchase-bill.purchase-bill'
    > &
      Schema.Attribute.Required;
    received_qty: Schema.Attribute.Decimal & Schema.Attribute.Required;
    received_qty_base: Schema.Attribute.Decimal & Schema.Attribute.Required;
    received_unit: Schema.Attribute.String & Schema.Attribute.Required;
    selling_price_paise: Schema.Attribute.BigInteger;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    tax_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPurchaseBillPurchaseBill
  extends Struct.CollectionTypeSchema {
  collectionName: 'purchase_bills';
  info: {
    description: "DATABASE_SCHEMA.md \u00A77.3 (GRN + invoice combined). This is what the Milestone 6 brief calls 'purchase_order' by its field list (invoice_number/invoice_date/payment_status) \u2014 reconciled to the DB spec's actual name here, since a genuinely different purchase_order (pre-order) content type already exists. Read-only via the Content API (routes/purchase-bill.ts) \u2014 all writes happen inside purchase-inward's Knex transaction, same pattern as order/shift.";
    displayName: 'Purchase Bill';
    pluralName: 'purchase-bills';
    singularName: 'purchase-bill';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    business_date: Schema.Attribute.Date & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    discount_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    due_date: Schema.Attribute.Date;
    freight_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    grn_no: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 30;
      }>;
    items: Schema.Attribute.Relation<
      'oneToMany',
      'api::purchase-bill-item.purchase-bill-item'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::purchase-bill.purchase-bill'
    > &
      Schema.Attribute.Private;
    other_charges_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    paid_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    payment_status: Schema.Attribute.Enumeration<
      ['UNPAID', 'PARTIALLY_PAID', 'PAID']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'UNPAID'>;
    publishedAt: Schema.Attribute.DateTime;
    purchase_order: Schema.Attribute.Relation<
      'manyToOne',
      'api::purchase-order.purchase-order'
    >;
    received_at: Schema.Attribute.DateTime & Schema.Attribute.Required;
    round_off_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    status: Schema.Attribute.Enumeration<
      ['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'CANCELLED']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'POSTED'>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    subtotal_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    supplier: Schema.Attribute.Relation<'manyToOne', 'api::supplier.supplier'> &
      Schema.Attribute.Required;
    supplier_invoice_date: Schema.Attribute.Date;
    supplier_invoice_no: Schema.Attribute.String;
    tax_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    total_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPurchaseOrderItemPurchaseOrderItem
  extends Struct.CollectionTypeSchema {
  collectionName: 'purchase_order_items';
  info: {
    description: 'DATABASE_SCHEMA.md \u00A77.2.';
    displayName: 'Purchase Order Item';
    pluralName: 'purchase-order-items';
    singularName: 'purchase-order-item';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    conversion_factor: Schema.Attribute.Decimal & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expected_rate_paise: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::purchase-order-item.purchase-order-item'
    > &
      Schema.Attribute.Private;
    ordered_qty: Schema.Attribute.Decimal & Schema.Attribute.Required;
    ordered_qty_base: Schema.Attribute.Decimal & Schema.Attribute.Required;
    ordered_unit: Schema.Attribute.String & Schema.Attribute.Required;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    purchase_order: Schema.Attribute.Relation<
      'manyToOne',
      'api::purchase-order.purchase-order'
    > &
      Schema.Attribute.Required;
    received_qty_base: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPurchaseOrderPurchaseOrder
  extends Struct.CollectionTypeSchema {
  collectionName: 'purchase_orders';
  info: {
    description: "DATABASE_SCHEMA.md \u00A77.2 \u2014 a pre-order/intent-to-buy, distinct from purchase-bill (the actual received-goods document, \u00A77.3). Plain Document Service CRUD is fine here: unlike purchase-bill, creating/editing a PO never touches inventory_batches or the supplier ledger, so there's no atomicity requirement forcing a Knex-transaction service.";
    displayName: 'Purchase Order';
    pluralName: 'purchase-orders';
    singularName: 'purchase-order';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expected_date: Schema.Attribute.Date;
    items: Schema.Attribute.Relation<
      'oneToMany',
      'api::purchase-order-item.purchase-order-item'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::purchase-order.purchase-order'
    > &
      Schema.Attribute.Private;
    note: Schema.Attribute.Text;
    po_no: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 30;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'DRAFT'>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    supplier: Schema.Attribute.Relation<'manyToOne', 'api::supplier.supplier'> &
      Schema.Attribute.Required;
    total_estimate_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiRoleRole extends Struct.CollectionTypeSchema {
  collectionName: 'roles';
  info: {
    description: "DATABASE_SCHEMA.md \u00A72.5 / PRD.md TEN-003. The 5 system roles (OWNER, MANAGER, CASHIER, INVENTORY_CLERK, ACCOUNTANT) are seeded at bootstrap (src/index.ts) with tenant = null. Per-tenant custom roles and the role_permissions catalogue are documented (TEN-003 notes 'permission-based not role-hardcoded', P2 custom roles) but out of this milestone's scope \u2014 only role identity (for routing/display) is wired up, not fine-grained permission enforcement.";
    displayName: 'Role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    discount_max_pct: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    is_system: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::role.role'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    tenant: Schema.Attribute.Relation<'manyToOne', 'api::tenant.tenant'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiShiftShift extends Struct.CollectionTypeSchema {
  collectionName: 'shifts';
  info: {
    description: 'DATABASE_SCHEMA.md \u00A75.1. Rules SH-1/SH-2 (at most one OPEN shift per counter, and per user per store) are DB partial-unique-index constraints (see migrations), not app-level checks \u2014 so they hold even under concurrent shift-open attempts. Writes happen through shift.service.ts, never bare Content-API CRUD (mirrors the order/checkout pattern).';
    displayName: 'Shift';
    pluralName: 'shifts';
    singularName: 'shift';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    actual_cash_paise: Schema.Attribute.BigInteger;
    approved_by: Schema.Attribute.Relation<
      'manyToOne',
      'api::app-user.app-user'
    >;
    bill_count: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    card_sales_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cash_collections_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cash_in_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cash_out_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cash_refunds_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cash_sales_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    cashier: Schema.Attribute.Relation<'manyToOne', 'api::app-user.app-user'> &
      Schema.Attribute.Required;
    closed_at: Schema.Attribute.DateTime;
    closed_by: Schema.Attribute.Relation<'manyToOne', 'api::app-user.app-user'>;
    counter: Schema.Attribute.Relation<'manyToOne', 'api::counter.counter'> &
      Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    credit_sales_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    denomination_count: Schema.Attribute.JSON;
    discount_total_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    expected_cash_paise: Schema.Attribute.BigInteger;
    force_closed: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::shift.shift'> &
      Schema.Attribute.Private;
    opened_at: Schema.Attribute.DateTime & Schema.Attribute.Required;
    opening_float_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    publishedAt: Schema.Attribute.DateTime;
    return_count: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    status: Schema.Attribute.Enumeration<
      ['OPEN', 'PENDING_COUNT', 'CLOSED', 'UNDER_REVIEW']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'OPEN'>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    upi_sales_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    variance_paise: Schema.Attribute.BigInteger;
    variance_reason_code: Schema.Attribute.Enumeration<
      [
        'MISCOUNT',
        'CHANGE_ERROR',
        'UNRECORDED_PAYOUT',
        'THEFT_SUSPECTED',
        'OTHER',
      ]
    >;
    variance_reason_text: Schema.Attribute.Text;
    void_count: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    wallet_sales_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
  };
}

export interface ApiStoreStore extends Struct.CollectionTypeSchema {
  collectionName: 'stores';
  info: {
    description: 'The tenant boundary for all operational data. DATABASE_SCHEMA.md \u00A72.2.';
    displayName: 'Store';
    pluralName: 'stores';
    singularName: 'store';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    address_line1: Schema.Attribute.String;
    address_line2: Schema.Attribute.String;
    business_preset: Schema.Attribute.Enumeration<
      ['KIRANA', 'SALOON', 'DHABA', 'REPAIR', 'DISTRIBUTOR']
    > &
      Schema.Attribute.DefaultTo<'KIRANA'>;
    categories: Schema.Attribute.Relation<
      'oneToMany',
      'api::category.category'
    >;
    city: Schema.Attribute.String;
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 10;
      }>;
    config: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<{}>;
    counters: Schema.Attribute.Relation<'oneToMany', 'api::counter.counter'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    currency: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 3;
      }> &
      Schema.Attribute.DefaultTo<'INR'>;
    customers: Schema.Attribute.Relation<'oneToMany', 'api::customer.customer'>;
    day_start_time: Schema.Attribute.Time &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'00:00:00.000'>;
    default_mode: Schema.Attribute.Enumeration<['KIRANA', 'RETAIL']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'KIRANA'>;
    financial_year_start: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 12;
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<4>;
    gstin: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 15;
      }>;
    invoice_prefix: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 10;
      }> &
      Schema.Attribute.DefaultTo<'INV'>;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::store.store'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    name_local: Schema.Attribute.String;
    phone: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 15;
      }>;
    pincode: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 6;
      }>;
    products: Schema.Attribute.Relation<'oneToMany', 'api::product.product'>;
    publishedAt: Schema.Attribute.DateTime;
    shifts: Schema.Attribute.Relation<'oneToMany', 'api::shift.shift'>;
    state_code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2;
        minLength: 2;
      }>;
    tenant: Schema.Attribute.Relation<'manyToOne', 'api::tenant.tenant'> &
      Schema.Attribute.Required;
    timezone: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'Asia/Kolkata'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSupplierSupplier extends Struct.CollectionTypeSchema {
  collectionName: 'suppliers';
  info: {
    description: "DATABASE_SCHEMA.md \u00A77.1. `phone` is AES-256-GCM encrypted, reusing src/api/customer/services/pii-crypto.ts (generic, not customer-specific) rather than duplicating that module \u2014 same design as customer.phone_enc, see that schema's description.";
    displayName: 'Supplier';
    pluralName: 'suppliers';
    singularName: 'supplier';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    address: Schema.Attribute.Text;
    contact_person: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    current_balance_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    email: Schema.Attribute.Email;
    gstin: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 15;
      }>;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::supplier.supplier'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    opening_balance_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'0'>;
    payment_terms_days: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    phone_enc: Schema.Attribute.Text;
    phone_hash: Schema.Attribute.String;
    phone_last4: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 4;
      }>;
    publishedAt: Schema.Attribute.DateTime;
    state_code: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 2;
        minLength: 2;
      }>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiTenantTenant extends Struct.CollectionTypeSchema {
  collectionName: 'tenants';
  info: {
    description: 'Top-level account owning one or more stores. Minimal stub \u2014 full tenant management is out of Milestone 1 scope; included only because store.tenant is a required relation in DATABASE_SCHEMA.md \u00A72.2.';
    displayName: 'Tenant';
    pluralName: 'tenants';
    singularName: 'tenant';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    gstin: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 15;
      }>;
    is_active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    legal_name: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::tenant.tenant'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    plan: Schema.Attribute.Enumeration<
      ['TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'STANDARD'>;
    publishedAt: Schema.Attribute.DateTime;
    stores: Schema.Attribute.Relation<'oneToMany', 'api::store.store'>;
    tenant_code: Schema.Attribute.String &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiUnitConversionUnitConversion
  extends Struct.CollectionTypeSchema {
  collectionName: 'unit_conversions';
  info: {
    description: 'DATABASE_SCHEMA.md \u00A73.4 / REQUIREMENTS.md \u00A71. Invariant UC-A (every product has exactly one row with factor_to_base = 1 and unit_code = product.base_unit) is enforced by a DB trigger \u2014 see database/migrations \u2014 and defended in application code by the unit-conversion lifecycle.';
    displayName: 'Unit Conversion';
    pluralName: 'unit-conversions';
    singularName: 'unit-conversion';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    factor_to_base: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0.000001;
        },
        number
      >;
    is_purchase_unit: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    is_sale_unit: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    label_local: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::unit-conversion.unit-conversion'
    > &
      Schema.Attribute.Private;
    price_override_paise: Schema.Attribute.BigInteger &
      Schema.Attribute.SetMinMax<
        {
          min: '0';
        },
        string
      >;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    sort_order: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    store: Schema.Attribute.Relation<'manyToOne', 'api::store.store'> &
      Schema.Attribute.Required;
    unit_code: Schema.Attribute.Enumeration<
      [
        'G',
        'KG',
        'QUINTAL',
        'ML',
        'L',
        'PCS',
        'DOZEN',
        'PACKET',
        'CARTON',
        'BORI',
        'CRATE',
      ]
    > &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesRelease
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_releases';
  info: {
    displayName: 'Release';
    pluralName: 'releases';
    singularName: 'release';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    actions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    releasedAt: Schema.Attribute.DateTime;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['ready', 'blocked', 'failed', 'done', 'empty']
    > &
      Schema.Attribute.Required;
    timezone: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesReleaseAction
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_release_actions';
  info: {
    displayName: 'Release Action';
    pluralName: 'release-actions';
    singularName: 'release-action';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentType: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entryDocumentId: Schema.Attribute.String;
    isEntryValid: Schema.Attribute.Boolean;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    release: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::content-releases.release'
    >;
    type: Schema.Attribute.Enumeration<['publish', 'unpublish']> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginI18NLocale extends Struct.CollectionTypeSchema {
  collectionName: 'i18n_locale';
  info: {
    collectionName: 'locales';
    description: '';
    displayName: 'Locale';
    pluralName: 'locales';
    singularName: 'locale';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::i18n.locale'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 1;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflow
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows';
  info: {
    description: '';
    displayName: 'Workflow';
    name: 'Workflow';
    pluralName: 'workflows';
    singularName: 'workflow';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentTypes: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'[]'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    stageRequiredToPublish: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::review-workflows.workflow-stage'
    >;
    stages: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflowStage
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows_stages';
  info: {
    description: '';
    displayName: 'Stages';
    name: 'Workflow Stage';
    pluralName: 'workflow-stages';
    singularName: 'workflow-stage';
  };
  options: {
    draftAndPublish: false;
    version: '1.1.0';
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#4945FF'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String;
    permissions: Schema.Attribute.Relation<'manyToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workflow: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::review-workflows.workflow'
    >;
  };
}

export interface PluginUploadFile extends Struct.CollectionTypeSchema {
  collectionName: 'files';
  info: {
    description: '';
    displayName: 'File';
    pluralName: 'files';
    singularName: 'file';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    alternativeText: Schema.Attribute.Text;
    caption: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ext: Schema.Attribute.String;
    focalPoint: Schema.Attribute.JSON;
    folder: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'> &
      Schema.Attribute.Private;
    folderPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    formats: Schema.Attribute.JSON;
    hash: Schema.Attribute.String & Schema.Attribute.Required;
    height: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.file'
    > &
      Schema.Attribute.Private;
    mime: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    previewUrl: Schema.Attribute.Text;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
    provider_metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    related: Schema.Attribute.Relation<'morphToMany'>;
    size: Schema.Attribute.Decimal & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.Text & Schema.Attribute.Required;
    width: Schema.Attribute.Integer;
  };
}

export interface PluginUploadFolder extends Struct.CollectionTypeSchema {
  collectionName: 'upload_folders';
  info: {
    displayName: 'Folder';
    pluralName: 'folders';
    singularName: 'folder';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    children: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.folder'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    files: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.file'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.folder'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    parent: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'>;
    path: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    pathId: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.role'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    >;
  };
}

export interface PluginUsersPermissionsUser
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'user';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
    timestamps: true;
  };
  attributes: {
    blocked: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    confirmationToken: Schema.Attribute.String & Schema.Attribute.Private;
    confirmed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    provider: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ContentTypeSchemas {
      'admin::api-token': AdminApiToken;
      'admin::api-token-permission': AdminApiTokenPermission;
      'admin::permission': AdminPermission;
      'admin::role': AdminRole;
      'admin::session': AdminSession;
      'admin::transfer-token': AdminTransferToken;
      'admin::transfer-token-permission': AdminTransferTokenPermission;
      'admin::user': AdminUser;
      'api::app-user-store-role.app-user-store-role': ApiAppUserStoreRoleAppUserStoreRole;
      'api::app-user.app-user': ApiAppUserAppUser;
      'api::b2b-order-item.b2b-order-item': ApiB2BOrderItemB2BOrderItem;
      'api::b2b-order.b2b-order': ApiB2BOrderB2BOrder;
      'api::category.category': ApiCategoryCategory;
      'api::counter.counter': ApiCounterCounter;
      'api::customer.customer': ApiCustomerCustomer;
      'api::inventory-batch.inventory-batch': ApiInventoryBatchInventoryBatch;
      'api::order-item.order-item': ApiOrderItemOrderItem;
      'api::order-payment.order-payment': ApiOrderPaymentOrderPayment;
      'api::order.order': ApiOrderOrder;
      'api::product.product': ApiProductProduct;
      'api::purchase-bill-item.purchase-bill-item': ApiPurchaseBillItemPurchaseBillItem;
      'api::purchase-bill.purchase-bill': ApiPurchaseBillPurchaseBill;
      'api::purchase-order-item.purchase-order-item': ApiPurchaseOrderItemPurchaseOrderItem;
      'api::purchase-order.purchase-order': ApiPurchaseOrderPurchaseOrder;
      'api::role.role': ApiRoleRole;
      'api::shift.shift': ApiShiftShift;
      'api::store.store': ApiStoreStore;
      'api::supplier.supplier': ApiSupplierSupplier;
      'api::tenant.tenant': ApiTenantTenant;
      'api::unit-conversion.unit-conversion': ApiUnitConversionUnitConversion;
      'plugin::content-releases.release': PluginContentReleasesRelease;
      'plugin::content-releases.release-action': PluginContentReleasesReleaseAction;
      'plugin::i18n.locale': PluginI18NLocale;
      'plugin::review-workflows.workflow': PluginReviewWorkflowsWorkflow;
      'plugin::review-workflows.workflow-stage': PluginReviewWorkflowsWorkflowStage;
      'plugin::upload.file': PluginUploadFile;
      'plugin::upload.folder': PluginUploadFolder;
      'plugin::users-permissions.permission': PluginUsersPermissionsPermission;
      'plugin::users-permissions.role': PluginUsersPermissionsRole;
      'plugin::users-permissions.user': PluginUsersPermissionsUser;
    }
  }
}

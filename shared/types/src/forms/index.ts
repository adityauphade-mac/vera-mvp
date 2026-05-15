/**
 * Barrel for shared form schemas. Each form-bearing component in the app
 * resolves against a schema in this directory; the matching API route imports
 * the same schema for server-side validation.
 */

export * from './email';

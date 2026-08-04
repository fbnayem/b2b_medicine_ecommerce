import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type FieldValues, type UseFormProps, type UseFormReturn } from 'react-hook-form';
import type { ZodType } from 'zod';

/**
 * Forms validated against the schemas the server actually enforces.
 *
 * There was no form library and no client-side validation anywhere:
 * `@medsupply/validation` holds every Zod schema the API validates against and
 * was imported by **zero** web files. So a shop owner learned that a phone
 * number was malformed by submitting the order and reading a sentence at the
 * top of the page, and a mistyped credit limit made a round trip to find out.
 *
 * Reusing the server's schema rather than restating the rules is the whole
 * point. A second copy of "a phone number looks like this" drifts from the
 * first, and the direction it drifts is always the same: the client accepts
 * something the server refuses, so the error arrives late and from a layer that
 * cannot point at the field.
 *
 * `mode: 'onBlur'` deliberately. Validating on every keystroke marks a field
 * red while somebody is still halfway through typing into it, which reads as
 * the form arguing with you; validating only on submit is what this replaces.
 * Once a field has been corrected, `reValidateMode` puts it back on change so
 * the error clears as soon as it is fixed.
 *
 * **Messages are English.** The schemas are server-side and their messages were
 * written for an API consumer. Routing them through the catalogue belongs with
 * the page-body translation work, and until then a Bangla form shows English
 * validation text — noted here rather than discovered later.
 */
export function useZodForm<Values extends FieldValues, Output extends FieldValues = Values>(
  /*
   * Both sides of the schema are named. The form holds the **input** type — a
   * field is a string in the DOM long before the schema has coerced it into a
   * number — while the submit handler receives the **output**, which is what
   * the API is actually sent. Collapsing the two would either type the form
   * against values it never holds or the handler against values it never gets.
   */
  schema: ZodType<Output, Values>,
  options?: Omit<UseFormProps<Values, unknown, Output>, 'resolver'>,
): UseFormReturn<Values, unknown, Output> {
  return useForm<Values, unknown, Output>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    ...options,
  });
}

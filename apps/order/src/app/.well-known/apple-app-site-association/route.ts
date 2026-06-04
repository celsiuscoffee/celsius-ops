/**
 * GET /.well-known/apple-app-site-association
 *
 * iOS Universal Links. Lets the Celsius Coffee app
 * (9U2R774T9W.com.celsiuscoffee.pickup.next) open
 * https://order.celsiuscoffee.com/table/* links directly when installed,
 * falling back to the browser when it isn't — the "scan QR → app if
 * installed, else web" behaviour. Pairs with ios.associatedDomains
 * "applinks:order.celsiuscoffee.com" in apps/pickup-native/app.json.
 *
 * Must be served as application/json at this exact path with NO file
 * extension (Apple's requirement). Response.json() sets the content type.
 */
export function GET() {
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: ["9U2R774T9W.com.celsiuscoffee.pickup.next"],
            components: [{ "/": "/table/*", comment: "QR table-order deep link" }],
          },
        ],
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

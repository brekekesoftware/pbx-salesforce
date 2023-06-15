# Salesforce Widget

Salesforce Integration for the PBX Widget.

## Usage

- Run the command `npm install` to install all the dependencies, then run `npm run build` to build the project.
- After building, copy the contents of the `dist` folder to a salesforce directory in your PBX webapps directory. EG `C:\Program Files\Brekeke\pbx\webapps\pbx\etc\widget\salesforce`
- Update your Salesforce Call center's CTI Adapter URL and CTI Standby URL to point to the widget. EG `[PBX_URL]/pbx/etc/widget/salesforce/index.html`

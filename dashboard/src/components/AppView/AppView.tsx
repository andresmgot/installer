import * as yaml from "js-yaml";
import * as _ from "lodash";
import * as React from "react";

import SecretTable from "../../containers/SecretsTableContainer";
import { Auth } from "../../shared/Auth";
import { hapi } from "../../shared/hapi/release";
import { IKubeItem, IRBACRole, IResource, ISecret } from "../../shared/types";
import WebSocketHelper from "../../shared/WebSocketHelper";
import DeploymentStatus from "../DeploymentStatus";
import { ErrorSelector } from "../ErrorAlert";
import LoadingWrapper from "../LoadingWrapper";
import AccessURLTable from "./AccessURLTable";
import AppControls from "./AppControls";
import AppNotes from "./AppNotes";
import "./AppView.css";
import ChartInfo from "./ChartInfo";
import DeploymentTable from "./DeploymentTable";
import OtherResourcesTable from "./OtherResourcesTable";
import ServiceTable from "./ServiceTable";

export interface IAppViewProps {
  namespace: string;
  releaseName: string;
  app: hapi.release.Release;
  // TODO(miguel) how to make optional props? I tried adding error? but the container complains
  error: Error | undefined;
  deleteError: Error | undefined;
  getApp: (releaseName: string, namespace: string) => void;
  deleteApp: (releaseName: string, namespace: string, purge: boolean) => Promise<boolean>;
}

interface IAppViewState {
  deployments: { [d: string]: IKubeItem<IResource> };
  otherResources: { [r: string]: IResource };
  services: { [s: string]: IKubeItem<IResource> };
  ingresses: { [i: string]: IKubeItem<IResource> };
  secrets: { [s: string]: ISecret };
  sockets: WebSocket[];
  manifest: IResource[];
}

const RequiredRBACRoles: { [s: string]: IRBACRole[] } = {
  view: [
    {
      apiGroup: "apps",
      resource: "deployments",
      verbs: ["list", "watch"],
    },
    {
      apiGroup: "apps",
      resource: "services",
      verbs: ["list", "watch"],
    },
  ],
};

class AppView extends React.Component<IAppViewProps, IAppViewState> {
  public state: IAppViewState = {
    manifest: [],
    deployments: {},
    ingresses: {},
    otherResources: {},
    services: {},
    secrets: {},
    sockets: [],
  };

  public async componentDidMount() {
    const { releaseName, getApp, namespace } = this.props;
    getApp(releaseName, namespace);
  }

  public componentWillReceiveProps(nextProps: IAppViewProps) {
    const { releaseName, getApp, namespace } = this.props;
    if (nextProps.namespace !== namespace) {
      getApp(releaseName, nextProps.namespace);
      return;
    }
    if (nextProps.error) {
      // close any existing sockets
      this.closeSockets();
      return;
    }
    const newApp = nextProps.app;
    if (!newApp) {
      return;
    }
    // TODO(prydonius): Okay to use non-safe load here since we assume the
    // manifest is pre-parsed by Helm and Kubernetes. Look into switching back
    // to safeLoadAll once https://github.com/nodeca/js-yaml/issues/456 is
    // resolved.
    let manifest: IResource[] = yaml.loadAll(newApp.manifest, undefined, { json: true });
    // Filter out elements in the manifest that does not comply
    // with { kind: foo }
    manifest = manifest.filter(r => r && r.kind);
    if (!_.isEqual(manifest, this.state.manifest)) {
      this.setState({ manifest });
    } else {
      return;
    }

    const kindsWithTable = ["Deployment", "Service", "Secret"];
    const otherResources = manifest
      .filter(d => kindsWithTable.indexOf(d.kind) < 0)
      .reduce((acc, r) => {
        // TODO: skip list resource for now
        if (r.kind === "List") {
          return acc;
        }
        acc[`${r.kind}/${r.metadata.name}`] = r;
        return acc;
      }, {});
    this.setState({ otherResources });

    const sockets: WebSocket[] = [];
    let secrets = {};
    manifest.forEach((i: IResource | ISecret) => {
      switch (i.kind) {
        case "Deployment":
          sockets.push(
            this.getSocket("deployments", i.apiVersion, i.metadata.name, newApp.namespace),
          );
          break;
        case "Service":
          sockets.push(this.getSocket("services", i.apiVersion, i.metadata.name, newApp.namespace));
          break;
        case "Ingress":
          sockets.push(
            this.getSocket("ingresses", i.apiVersion, i.metadata.name, newApp.namespace),
          );
          break;
        case "Secret":
          const secret = i as ISecret;
          secrets = { ...secrets, [secret.metadata.name]: secret };
          break;
      }
    });
    this.setState({
      sockets,
      secrets,
    });
  }

  public componentWillUnmount() {
    this.closeSockets();
  }

  public handleEvent(e: MessageEvent) {
    const msg = JSON.parse(e.data);
    const resource: IResource = msg.object;
    const key = `${resource.kind}/${resource.metadata.name}`;
    switch (resource.kind) {
      case "Deployment":
        this.setState({
          deployments: { ...this.state.deployments, [key]: { item: resource, isFetching: false } },
        });
        break;
      case "Service":
        this.setState({
          services: { ...this.state.services, [key]: { item: resource, isFetching: false } },
        });
        break;
      case "Ingress":
        this.setState({
          ingresses: { ...this.state.ingresses, [key]: { item: resource, isFetching: false } },
        });
        break;
    }
  }

  public get isAppLoading(): boolean {
    const { app } = this.props;
    return !app || !app.info;
  }

  public render() {
    if (this.props.error) {
      return (
        <ErrorSelector
          error={this.props.error}
          defaultRequiredRBACRoles={RequiredRBACRoles}
          action="view"
          resource={`Application ${this.props.releaseName}`}
          namespace={this.props.namespace}
        />
      );
    }

    return this.isAppLoading ? <LoadingWrapper /> : this.appInfo();
  }

  public appInfo() {
    const { app } = this.props;
    const services = this.arrayFromState("services");
    const areServicesLoading = this.isLoading("services");
    const ingresses = this.arrayFromState("ingresses");
    const areIngressesLoading = this.isLoading("ingresses");
    const deployments = this.arrayFromState("deployments");
    const areDeploymentsLoading = this.isLoading("deployments");
    // Although LoadingWrapper checks that the app is loaded before loading this wrapper
    // it seems that react renders it even before causing it to crash because app is null
    // that's why we need to have an app && guard clause
    return (
      <section className="AppView padding-b-big">
        <main>
          <div className="container">
            {this.props.deleteError && (
              <ErrorSelector
                error={this.props.deleteError}
                defaultRequiredRBACRoles={RequiredRBACRoles}
                action="delete"
                resource={`Application ${this.props.releaseName}`}
                namespace={this.props.namespace}
              />
            )}
            <div className="row collapse-b-tablet">
              <div className="col-3">
                <ChartInfo app={app} />
              </div>
              <div className="col-9">
                <div className="row padding-t-bigger">
                  <div className="col-4">
                    <DeploymentStatus deployments={deployments} info={app.info!} />
                  </div>
                  <div className="col-8 text-r">
                    <AppControls app={app} deleteApp={this.deleteApp} />
                  </div>
                </div>
                <h6>Access URLs</h6>
                <LoadingWrapper loaded={!areServicesLoading && !areIngressesLoading} size="small">
                  <AccessURLTable services={services} ingresses={ingresses} />
                </LoadingWrapper>
                <AppNotes notes={app.info && app.info.status && app.info.status.notes} />
                <SecretTable
                  namespace={app.namespace}
                  secretNames={Object.keys(this.state.secrets)}
                />
                <h6>Deployments</h6>
                <LoadingWrapper loaded={!areDeploymentsLoading} size="small">
                  <DeploymentTable deployments={deployments} />
                </LoadingWrapper>
                <h6>Services</h6>
                <LoadingWrapper loaded={!areServicesLoading} size="small">
                  <ServiceTable services={services} />
                </LoadingWrapper>
                <h6>Other Resources</h6>
                <OtherResourcesTable otherResources={this.state.otherResources} />
              </div>
            </div>
          </div>
        </main>
      </section>
    );
  }

  private getSocket(
    resource: string,
    apiVersion: string,
    name: string,
    namespace: string,
  ): WebSocket {
    const apiBase = WebSocketHelper.apiBase();
    const s = new WebSocket(
      `${apiBase}/${
        apiVersion === "v1" ? "api/v1" : `apis/${apiVersion}`
      }/namespaces/${namespace}/${resource}?watch=true&fieldSelector=metadata.name%3D${name}`,
      Auth.wsProtocols(),
    );
    s.addEventListener("message", e => this.handleEvent(e));
    return s;
  }

  private closeSockets() {
    const { sockets } = this.state;
    for (const s of sockets) {
      s.close();
    }
  }

  // Retrieve the deployments/service/ingresses if they are already loaded
  private arrayFromState(type: string): IResource[] {
    const elems = Object.keys(this.state[type]);
    const res: IResource[] = [];
    elems.forEach(e => {
      if (this.state[type][e].resource) {
        res.push(this.state[type][e].resource);
      }
    });
    return res;
  }

  // Retrieve is some deployments/service/ingresses is still loading
  private isLoading(type: string) {
    return _.some(this.state[type], e => e.isFetching);
  }

  private deleteApp = (purge: boolean) => {
    return this.props.deleteApp(this.props.releaseName, this.props.namespace, purge);
  };
}

export default AppView;

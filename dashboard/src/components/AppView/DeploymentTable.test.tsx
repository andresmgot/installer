import { shallow } from "enzyme";
import * as React from "react";

import { IResource } from "shared/types";
import DeploymentItem from "./DeploymentItem";
import DeploymentTable from "./DeploymentTable";

it("renders a deployment ready", () => {
  const deployments = [
    {
      kind: "Deployment",
      metadata: {
        name: "foo",
      },
      status: {},
    } as IResource,
  ];
  const wrapper = shallow(<DeploymentTable deployments={deployments} />);
  expect(wrapper).toMatchSnapshot();
  expect(wrapper.find(DeploymentItem).key()).toBe("foo");
});

it("renders two deployments", () => {
  const deployments = [
    {
      kind: "Deployment",
      metadata: {
        name: "foo",
      },
      status: {},
    } as IResource,
    {
      kind: "Deployment",
      metadata: {
        name: "bar",
      },
      status: {},
    } as IResource,
  ];
  const wrapper = shallow(<DeploymentTable deployments={deployments} />);
  expect(wrapper.find(DeploymentItem).length).toBe(2);
  expect(
    wrapper
      .find(DeploymentItem)
      .at(0)
      .key(),
  ).toBe(deployments[0]);
  expect(
    wrapper
      .find(DeploymentItem)
      .at(1)
      .key(),
  ).toBe(deployments[1]);
});
